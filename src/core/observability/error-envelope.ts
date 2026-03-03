import type { ExecutionPhase, ErrorEnvelope, ErrorDomain } from '../types/index.js';

import { mapErrorForDisplay } from './error-mapping.js';

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
  safeHint?: string;
  remediationSteps?: string[];
  redacted?: boolean;
  redactionSource?: string;
  safeMeta?: Record<string, unknown>;
  debugArtifact?: ErrorEnvelope['debugArtifact'];
}): ErrorEnvelope {
  return {
    domain: params.domain,
    code: params.code,
    phase: params.phase,
    safeMessage: params.safeMessage,
    safeHint: params.safeHint,
    remediationSteps: params.remediationSteps,
    redacted: params.redacted,
    redactionSource: params.redactionSource,
    safeMeta: params.safeMeta,
    debugArtifact: params.debugArtifact,
  };
}

function inferErrorDomain(code?: string): ErrorDomain {
  if (!code) return 'unknown';
  if (code.startsWith('LLM_')) return 'llm';
  if (code.startsWith('GIT_')) return 'git';
  if (code.startsWith('PATCH_') || code.startsWith('DIFF_')) return 'runtime';
  if (code.startsWith('VERIFY_')) return 'verification';
  return 'unknown';
}

export function buildFailureEnvelope(params: {
  code?: string;
  phase?: ExecutionPhase;
  safeHint?: string;
  remediationSteps?: string[];
  fallbackMessage: string;
}): ErrorEnvelope {
  const code = params.code ?? 'UNKNOWN_ERROR';
  const messageSource = params.safeHint ?? params.fallbackMessage;
  const mapped = mapErrorForDisplay({ message: messageSource, code });
  return buildErrorEnvelope({
    domain: inferErrorDomain(code),
    code,
    phase: params.phase,
    safeMessage: mapped.message,
    safeHint: params.safeHint ?? params.fallbackMessage,
    remediationSteps: params.remediationSteps,
    redacted: mapped.redacted,
  });
}
