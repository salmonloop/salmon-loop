import { text } from '../../locales/index.js';
import { SalmonError } from '../types.js';

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
      details.responseBody = truncate(candidate.responseBody);

      // Try to parse JSON from responseBody to get a better message
      try {
        const parsed = JSON.parse(candidate.responseBody);
        if (parsed?.error?.message) {
          details.providerMessage = parsed.error.message;
        } else if (parsed?.message) {
          details.providerMessage = parsed.message;
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
        details.providerMessage = truncate(errInfo.message);
      } else if (typeof errInfo.details === 'string') {
        details.providerMessage = truncate(errInfo.details);
      }
    }

    // Also check if the 'message' property itself contains JSON (common in some SDK wrappers)
    if (!details.providerMessage && typeof candidate.message === 'string') {
      const jsonMatch = candidate.message.match(/HTTP \d+: ({[\s\S]*})/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed?.error?.message) {
            details.providerMessage = parsed.error.message;
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
 * Sanitizes an error message by removing sensitive data (Zod dumps, JSON, stack traces)
 * unless they match a known safe pattern.
 */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'UnknownError';

  // 1. Check for Zod/Validation dumps (common in AI SDK)
  const isValidation =
    name === 'AI_TypeValidationError' ||
    name === 'TypeValidationError' ||
    name === 'ZodError' ||
    (err as any)?.cause?.name === 'ZodError' ||
    msg.includes('"code": "invalid_union"') ||
    msg.includes('ZodError: [') ||
    /(?:\\?['"])?code(?:\\?['"])?\s*:\s*(?:\\?['"])?invalid_(?:union|type|value|enum|string|date|literal)(?:\\?['"])?/i.test(
      msg,
    );

  if (isValidation) {
    return 'Model validation failed: The provider returned a response that did not match the expected schema.';
  }

  // 2. Allowlist of safe patterns
  const SAFE_ERROR_PATTERNS = [
    /timeout/i,
    /rate.?limit/i,
    /insufficient.?quota/i,
    /credit/i,
    /context.?length/i,
    /token.?limit/i,
    /unauthorized/i,
    /authentication/i,
    /api.?key/i,
    /not.?found/i,
    /internal.?server.?error/i,
    /overloaded/i,
    /bad.?gateway/i,
    /service.?unavailable/i,
    /aborted/i,
    /connection/i,
    /license/i,
    /access.?denied/i,
    /unexpected end of json/i,
  ];

  const isSafe = SAFE_ERROR_PATTERNS.some((p) => p.test(msg));
  // Heuristic: If it looks like a JSON dump (starts with { or [) or is excessively long
  const isSuspicious = /^\s*[{[]/.test(msg) || msg.length > 300;

  if (!isSafe && isSuspicious) {
    return 'Provider request failed. The error message was sanitized for security reasons (see audit logs for details).';
  }

  return msg;
}

export function toLlmError(err: unknown, provider?: string): LlmError {
  const name = err instanceof Error ? err.name : 'UnknownError';
  let message = err instanceof Error ? err.message : String(err);

  // Unwrap RetryError to get the last error's message if available
  if (name === 'AI_RetryError' || (err as any)?.lastError) {
    const lastError = (err as any).lastError;
    if (lastError instanceof Error) {
      message = lastError.message;
    }
  }

  // Use provider-specific details if available
  const providerDetails = extractProviderDetails(err);
  if (providerDetails.providerMessage) {
    message = providerDetails.providerMessage;
  }

  // Apply unified sanitization
  const sanitizedMessage = sanitizeError(err);
  const isValidationFailure = sanitizedMessage.includes('Model validation failed');

  const meta: LlmErrorMeta = {
    provider,
    causeName: name,
    causeMessage: truncate(err instanceof Error ? err.message : String(err), 2000),
    ...providerDetails,
  };

  if (isValidationFailure) {
    return new LlmError(sanitizedMessage, 'LLM_VALIDATION_FAILED', meta);
  }

  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new LlmError(text.llmErrors.httpAborted, 'LLM_HTTP_ABORTED', meta);
  }

  if (/Unexpected end of JSON input/i.test(message)) {
    return new LlmError(text.llmErrors.httpInvalidJson, 'LLM_HTTP_RESPONSE_INVALID_JSON', meta);
  }

  return new LlmError(sanitizedMessage, 'LLM_HTTP_REQUEST_FAILED', meta);
}

export function wrapPlanEmpty(): LlmError {
  return new LlmError(text.llm.planEmpty, 'LLM_PLAN_EMPTY');
}

export function wrapPlanInvalidJson(): LlmError {
  return new LlmError(text.llm.planInvalid, 'LLM_PLAN_INVALID_JSON');
}

export function wrapPatchEmpty(reason?: string): LlmError {
  const msg = reason ? text.llm.patchEmpty(reason) : text.llm.patchEmpty();
  return new LlmError(msg, 'LLM_PATCH_EMPTY');
}

export function wrapPatchNotUnifiedDiff(): LlmError {
  return new LlmError(text.diff.notUnifiedFormat, 'LLM_PATCH_NOT_UNIFIED_DIFF');
}

export function wrapPatchInvalid(message: string): LlmError {
  return new LlmError(message, 'LLM_PATCH_INVALID');
}
