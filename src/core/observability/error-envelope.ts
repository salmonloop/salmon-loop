import type { ExecutionPhase, ErrorEnvelope, ErrorDomain } from '../types/index.js';

export const REDACTED_ERROR_TOKEN = 'ERR_TECHNICAL_DETAILS_HIDDEN';

export function isRedactedErrorToken(value: unknown): value is typeof REDACTED_ERROR_TOKEN {
  return value === REDACTED_ERROR_TOKEN;
}

export function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    return (
      (error as { llmCode?: string; code?: string; name?: string }).llmCode ??
      (error as { llmCode?: string; code?: string; name?: string }).code ??
      (error as { llmCode?: string; code?: string; name?: string }).name
    );
  }
  return undefined;
}

export function toSafeErrorSummary(error: unknown): Record<string, unknown> {
  const code = extractErrorCode(error);
  const name = error instanceof Error ? error.name : typeof error;
  return {
    name,
    code,
  };
}

export function buildErrorEnvelope(params: {
  domain: ErrorDomain;
  code: string;
  phase?: ExecutionPhase;
  safeMessage: string;
  safeMeta?: Record<string, unknown>;
  debugArtifact?: ErrorEnvelope['debugArtifact'];
}): ErrorEnvelope {
  return {
    domain: params.domain,
    code: params.code,
    phase: params.phase,
    safeMessage: params.safeMessage,
    safeMeta: params.safeMeta,
    debugArtifact: params.debugArtifact,
  };
}
