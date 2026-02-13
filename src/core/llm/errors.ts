import { SalmonError } from '../types/index.js';
import { sanitizeErrorMessage } from '../utils/sanitizer.js';

export type LlmErrorCode =
  | 'LLM_HTTP_RESPONSE_INVALID_JSON'
  | 'LLM_HTTP_ABORTED'
  | 'LLM_HTTP_REQUEST_FAILED'
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

/**
 * Sanitizes an error message using the shared utility to prevent leakage
 * of sensitive technical data.
 */
export function sanitizeError(err: unknown): string {
  return sanitizeErrorMessage(err);
}

export function toLlmError(err: unknown, provider?: string): LlmError {
  let name = err instanceof Error ? err.name : 'UnknownError';
  let message = err instanceof Error ? err.message : String(err);

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
  return new LlmError('LLM request failed', 'LLM_HTTP_REQUEST_FAILED', meta);
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
