import { SalmonError } from '../types/errors.js';
import { sanitizeErrorMessage } from '../utils/sanitizer.js';

export type LlmErrorCode =
  | 'LLM_AUTHENTICATION_FAILED'
  | 'LLM_HTTP_RESPONSE_INVALID_JSON'
  | 'LLM_HTTP_ABORTED'
  | 'LLM_HTTP_REQUEST_FAILED'
  | 'LLM_RATE_LIMITED'
  | 'LLM_UPSTREAM_5XX'
  | 'LLM_NETWORK_UNREACHABLE'
  | 'LLM_REQUEST_TIMEOUT'
  | 'LLM_CONTEXT_LENGTH_EXCEEDED'
  | 'LLM_PLAN_EMPTY'
  | 'LLM_PLAN_INVALID_JSON'
  | 'LLM_PATCH_EMPTY'
  | 'LLM_PATCH_NOT_UNIFIED_DIFF'
  | 'LLM_PATCH_INVALID'
  | 'LLM_VALIDATION_FAILED';

export interface LlmErrorMeta {
  provider?: string;
  causeName?: string;
  causeMessage?: string;
  statusCode?: number;
  responseBody?: string;
  providerMessage?: string;
}

export class LlmError extends SalmonError {
  constructor(
    message: string,
    public readonly llmCode: LlmErrorCode,
    public readonly meta?: LlmErrorMeta,
  ) {
    // Ensure SalmonError receives llmCode as its core code
    super(message, llmCode);
  }
}

function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '...';
}

function extractProviderDetails(err: unknown): {
  statusCode?: number;
  responseBody?: string;
  providerMessage?: string;
} {
  const details: { statusCode?: number; responseBody?: string; providerMessage?: string } = {};
  if (err && typeof err === 'object') {
    const candidate = err as Record<string, unknown>;

    // Handle AI SDK's APICallError/RetryError structure
    if (candidate.lastError) {
      return extractProviderDetails(candidate.lastError);
    }

    if (typeof candidate.statusCode === 'number') {
      details.statusCode = candidate.statusCode;
    }

    // Align with AI SDK error shapes that store HTTP status in response.status
    const response = candidate.response as Record<string, unknown> | undefined;
    if (typeof details.statusCode !== 'number' && response && typeof response.status === 'number') {
      details.statusCode = response.status;
    }

    if (typeof candidate.responseBody === 'string') {
      // Apply sanitization to responseBody immediately after truncation
      details.responseBody = sanitizeError(truncate(candidate.responseBody));

      // Try to parse JSON from responseBody to get a better message
      try {
        const parsed = JSON.parse(candidate.responseBody);
        if (parsed?.error?.message) {
          details.providerMessage = sanitizeError(parsed.error.message);
        } else if (parsed?.message) {
          details.providerMessage = sanitizeError(parsed.message);
        }
      } catch {
        // ignore
      }
    } else if (candidate.responseBody) {
      details.responseBody = truncate(JSON.stringify(candidate.responseBody));
    }

    // Check for nested error objects (common in Google/Anthropic APIs)
    const data = candidate.data as Record<string, unknown> | undefined;
    if (data && typeof data.error === 'object' && data.error) {
      const errInfo = data.error as Record<string, unknown>;
      if (typeof errInfo.message === 'string') {
        details.providerMessage = sanitizeError(truncate(errInfo.message));
      } else if (typeof errInfo.details === 'string') {
        details.providerMessage = sanitizeError(truncate(errInfo.details));
      }
    }

    // Also check if the 'message' property itself contains JSON (common in some SDK wrappers)
    if (!details.providerMessage && typeof candidate.message === 'string') {
      const jsonMatch = candidate.message.match(/HTTP \d+: ({[\s\S]*})/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed?.error?.message) {
            details.providerMessage = sanitizeError(parsed.error.message);
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return details;
}

function extractNetworkCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const candidate = err as Record<string, unknown>;

  const direct = candidate.code;
  if (typeof direct === 'string' && direct.trim()) return direct;

  const cause = (candidate as any).cause;
  if (cause && typeof cause === 'object' && typeof (cause as any).code === 'string') {
    const code = String((cause as any).code);
    return code.trim() ? code : undefined;
  }

  return undefined;
}

function isAuthenticationFailure(input: {
  statusCode?: number;
  message: string;
  providerMessage?: string;
  sanitizedMessage: string;
}): boolean {
  if (input.statusCode === 401) return true;

  const lower =
    `${input.message} ${input.providerMessage ?? ''} ${input.sanitizedMessage}`.toLowerCase();

  const authHints = [
    'unauthorized',
    'forbidden',
    'authentication failed',
    'auth failed',
    'invalid api key',
    'invalid api-key',
    'access denied',
    'permission denied',
    'credential',
    'appidnoautherror',
    'noautherror',
  ];

  if (authHints.some((hint) => lower.includes(hint))) {
    return true;
  }

  return input.statusCode === 403 && /auth|access|permission|credential|forbidden/i.test(lower);
}

/**
 * Sanitizes an error message using the shared utility to prevent leakage
 * of sensitive technical data.
 */
export function sanitizeError(err: unknown): string {
  return sanitizeErrorMessage(err);
}

export function toLlmError(err: unknown, provider?: string): LlmError {
  let name =
    err instanceof Error
      ? err.name
      : typeof (err as any)?.name === 'string'
        ? String((err as any).name)
        : 'UnknownError';
  let message =
    err instanceof Error
      ? err.message
      : typeof (err as any)?.message === 'string'
        ? String((err as any).message)
        : String(err);

  // Unwrap RetryError to get the last error's message if available
  if (name === 'AI_RetryError' || (err as any)?.lastError) {
    const lastError = (err as any).lastError;
    // Update the error reference so subsequent checks work on the actual cause
    err = lastError;
    if (lastError instanceof Error) {
      name = lastError.name;
      message = lastError.message;
    }
  }

  // Handle AI SDK Validation Errors (Zod)
  if (
    name === 'AI_TypeValidationError' ||
    name === 'ZodError' ||
    name.includes('TypeValidationError') ||
    message.includes('TypeValidationError') ||
    (err as any)?.[Symbol.for('vercel.ai.error.AI_TypeValidationError')]
  ) {
    return new LlmError('LLM validation failed', 'LLM_VALIDATION_FAILED', {
      provider,
      causeName: name,
      causeMessage: sanitizeError(err),
    });
  }

  // Use provider-specific details if available
  const providerDetails = extractProviderDetails(err);
  if (providerDetails.providerMessage) {
    message = providerDetails.providerMessage;
  }

  // Apply unified sanitization
  const sanitizedMessage = sanitizeError(err);
  const isValidationFailure =
    sanitizedMessage.includes('validation failed') || name === 'AI_TypeValidationError';

  const meta: LlmErrorMeta = {
    provider,
    causeName: name,
    causeMessage: sanitizeError(err),
    ...providerDetails,
  };

  if (isValidationFailure) {
    return new LlmError(sanitizedMessage, 'LLM_VALIDATION_FAILED', meta);
  }

  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new LlmError('Request aborted', 'LLM_HTTP_ABORTED', meta);
  }

  if (/Unexpected end of JSON input/i.test(message)) {
    return new LlmError('Invalid JSON response from LLM', 'LLM_HTTP_RESPONSE_INVALID_JSON', meta);
  }

  // Use a generic message for all other HTTP failures
  if (
    isContextLengthExceeded({
      statusCode: meta.statusCode,
      providerMessage: meta.providerMessage,
    })
  ) {
    return new LlmError('LLM context length exceeded', 'LLM_CONTEXT_LENGTH_EXCEEDED', meta);
  }

  const lower = `${message} ${meta.providerMessage ?? ''} ${sanitizedMessage}`.toLowerCase();
  const statusCode = meta.statusCode;
  const networkCode = extractNetworkCode(err)?.toUpperCase();

  if (
    isAuthenticationFailure({
      statusCode,
      message,
      providerMessage: meta.providerMessage,
      sanitizedMessage,
    })
  ) {
    return new LlmError('LLM authentication failed', 'LLM_AUTHENTICATION_FAILED', meta);
  }

  if (statusCode === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return new LlmError('LLM rate limited', 'LLM_RATE_LIMITED', meta);
  }

  if (statusCode === 408 || lower.includes('timeout') || networkCode === 'ETIMEDOUT') {
    return new LlmError('LLM request timed out', 'LLM_REQUEST_TIMEOUT', meta);
  }

  if (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600) {
    return new LlmError('LLM upstream server error', 'LLM_UPSTREAM_5XX', meta);
  }

  if (typeof networkCode === 'string') {
    const unreachable = new Set([
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNREFUSED',
    ]);
    if (unreachable.has(networkCode)) {
      return new LlmError('LLM network request failed', 'LLM_NETWORK_UNREACHABLE', meta);
    }
  }

  return new LlmError('LLM request failed', 'LLM_HTTP_REQUEST_FAILED', meta);
}

function isContextLengthExceeded(input: {
  statusCode?: number;
  providerMessage?: string;
}): boolean {
  if (input.statusCode !== 400 && input.statusCode !== 413) return false;
  const msg = (input.providerMessage ?? '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('maximum context length') ||
    msg.includes('context length') ||
    msg.includes('too many tokens') ||
    msg.includes('prompt is too long') ||
    msg.includes('input is too long') ||
    msg.includes('reduce the length') ||
    msg.includes('please reduce')
  );
}

export function wrapPlanEmpty(): LlmError {
  return new LlmError('LLM returned an empty plan', 'LLM_PLAN_EMPTY');
}

export function wrapPlanInvalidJson(): LlmError {
  return new LlmError('LLM returned invalid JSON for plan', 'LLM_PLAN_INVALID_JSON');
}

export function wrapPatchEmpty(reason?: string): LlmError {
  const msg = reason ? `LLM returned an empty patch: ${reason}` : 'LLM returned an empty patch';
  return new LlmError(msg, 'LLM_PATCH_EMPTY');
}

export function wrapPatchNotUnifiedDiff(): LlmError {
  return new LlmError('LLM patch is not in unified diff format', 'LLM_PATCH_NOT_UNIFIED_DIFF');
}

export function wrapPatchInvalid(message: string): LlmError {
  return new LlmError(message, 'LLM_PATCH_INVALID');
}

export function isContextOverflowError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('llmCode' in (error as any) && (error as any).llmCode === 'LLM_CONTEXT_LENGTH_EXCEEDED') {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as any).message === 'string'
        ? String((error as any).message)
        : '';
  const lower = message.toLowerCase();
  return (
    lower.includes('maximum context length') ||
    lower.includes('context length') ||
    lower.includes('too many tokens') ||
    lower.includes('prompt is too long') ||
    lower.includes('input is too long') ||
    lower.includes('please reduce')
  );
}
