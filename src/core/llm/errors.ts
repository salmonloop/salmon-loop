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
  | 'LLM_PATCH_INVALID';

export interface LlmErrorMeta {
  provider?: string;
  causeName?: string;
  causeMessage?: string;
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

export function toLlmError(err: unknown, provider?: string): LlmError {
  const name = err instanceof Error ? err.name : 'UnknownError';
  const message = err instanceof Error ? err.message : String(err);

  const meta: LlmErrorMeta = {
    provider,
    causeName: name,
    causeMessage: truncate(message),
  };

  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new LlmError(text.llmErrors.httpAborted, 'LLM_HTTP_ABORTED', meta);
  }

  if (/Unexpected end of JSON input/i.test(message)) {
    return new LlmError(text.llmErrors.httpInvalidJson, 'LLM_HTTP_RESPONSE_INVALID_JSON', meta);
  }

  return new LlmError(text.llmErrors.httpRequestFailed, 'LLM_HTTP_REQUEST_FAILED', meta);
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
