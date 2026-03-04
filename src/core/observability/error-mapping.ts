import { text } from '../../locales/index.js';

import type { AuditTrailEvent } from './audit-trail.js';
import { REDACTED_ERROR_TOKEN } from './error-envelope.js';

export interface ErrorDisplayInput {
  message?: string;
  code?: string;
}

export interface ErrorDisplayOutput {
  message: string;
  code?: string;
  redacted: boolean;
}

export interface ErrorAuditOutput {
  summary: string;
  category: string;
  code?: string;
  redacted: boolean;
}

function mapLlmCodeToMessage(code: string): string | undefined {
  if (!code.startsWith('LLM_')) return undefined;

  const camelCode = code
    .toLowerCase()
    .replace(/_([a-z])/g, (_, g) => g.toUpperCase())
    .replace(/^llm/, '');
  const finalCamel = camelCode.charAt(0).toLowerCase() + camelCode.slice(1);

  const llmErrors = text.llmErrors as Record<string, string | undefined>;
  const llmText = text.llm as Record<string, unknown>;

  const candidate = llmErrors[finalCamel] ?? llmText[finalCamel];
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate === 'function') return candidate();
  return undefined;
}

function mapUsageErrorMessage(message: string, code?: string): string | undefined {
  if (code !== 'USAGE_ERROR') return undefined;
  switch (message) {
    case 'PRINT_INSTRUCTION_CONFLICT':
      return text.errors.usagePrintInstructionConflict;
    case 'CONTINUE_RESUME_CONFLICT':
      return text.errors.usageContinueResumeConflict;
    case 'OUTPUT_PROFILE_REQUIRES_STREAM_JSON':
      return text.errors.usageOutputProfileRequiresStreamJson;
    case 'INVALID_OUTPUT_PROFILE':
      return text.errors.usageInvalidOutputProfile;
    case 'JSON_SCHEMA_REQUIRES_JSON':
      return text.errors.usageJsonSchemaRequiresJson;
    default:
      return undefined;
  }
}

function mapMessageToken(message: string): string | undefined {
  switch (message) {
    case 'UNKNOWN_SLASH':
      return text.errors.unknownSlash;
    case 'NO_HANDLER':
      return text.errors.noSlashHandler;
    case 'INTERNAL_ERROR':
      return text.errors.internalError;
    case 'ALLOWLIST_PARSE_FAILED':
      return text.errors.allowlistParseFailed;
    case 'ALLOWLIST_WRITE_FAILED':
      return text.errors.allowlistWriteFailed;
    case 'ALLOWLIST_CACHE_WRITE_FAILED':
      return text.errors.allowlistCacheWriteFailed;
    case 'ALLOWLIST_LOCK_TIMEOUT':
      return text.errors.allowlistLockTimeout;
    case 'ALLOWLIST_LOCK_VERIFICATION_FAILED':
      return text.errors.allowlistLockVerificationFailed;
    case 'ALLOWLIST_ATOMIC_WRITE_BACKUP_FAILED':
      return text.errors.allowlistAtomicWriteBackupFailed;
    case 'ALLOWLIST_ATOMIC_RESTORE_FAILED':
      return text.errors.allowlistAtomicRestoreFailed;
    case 'ALLOWLIST_PATH_BLOCKED':
      return text.errors.allowlistPathBlocked;
    default:
      return undefined;
  }
}

type CodeMessageLookup = Record<string, () => string>;

const CODE_MESSAGE_MAP: CodeMessageLookup = {
  noFilesRead: () => text.errors.noFilesRead,
  explorationHallucination: () => text.errors.explorationHallucination,
  PREFLIGHT_NOT_GIT: () => text.errors.preflightNotGit,
  PREFLIGHT_DIRTY: () => text.errors.preflightDirty,
  APPLY_BACK_FAILED: () => text.errors.applyBackFailed,
  PATCH_NOT_APPLICABLE: () => text.errors.patchNotApplicable,
  DIFF_VALIDATION_FAILED: () => text.errors.diffValidationFailed,
  GIT_ERROR: () => text.errors.gitError,
  SCHEMA_INVALID: () => text.errors.schemaInvalid,
  SCHEMA_VALIDATION_FAILED: () => text.errors.schemaValidationFailed,
  SCHEMA_VIOLATION: () => text.errors.schemaViolation,
  USAGE_ERROR: () => text.errors.usageError,
  INTERRUPT_REQUIRED: () => text.errors.interruptRequired,
  PERMISSION_RULE_DENY: () => text.errors.permissionRuleDeny,
  PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT: () =>
    text.errors.permissionRequiredContextCacheOutsideRoot,
  PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT: () =>
    text.errors.permissionDeniedContextCacheOutsideRoot,
  compilation: () => text.errors.compilationFailed,
  lint: () => text.errors.lintFailed,
  test: () => text.errors.testFailed,
  logic: () => text.errors.logicFailed,
  dependency_error: () => text.errors.dependencyError,
  DEPENDENCY_ERROR: () => text.errors.dependencyError,
  resource_lock_error: () => text.errors.resourceLockError,
  ast_validation_error: () => text.errors.astValidationError,
  unknown: () => text.errors.unknownError,
  TIMEOUT: () => text.errors.timeout,
  RUNTIME_ERROR: () => text.errors.runtimeError,
  TOOL_PARSE_ERROR: () => text.errors.toolParseError,
  OUTPUT_PARSE_FAILED: () => text.errors.outputParseFailed,
  AUTH_REQUIRED: () => text.errors.authRequired,
  ASK_USER_CANCELLED: () => text.errors.askUserCancelled,
  ASK_USER_SUBAGENT_BLOCKED: () => text.errors.askUserSubagentBlocked,
  SERIALIZE_ERROR: () => text.errors.serializeError,
  PARSE_ERROR: () => text.errors.parseError,
  EXECUTION_ERROR: () => text.errors.executionError,
  INVALID_OUTPUT: () => text.errors.invalidOutput,
  OUTPUT_TRUNCATED: () => text.errors.outputTruncated,
  PIPELINE_RECOVERY_FAILED: () => text.errors.pipelineRecoveryFailed,
  UNKNOWN_SLASH: () => text.errors.unknownSlash,
  NO_HANDLER: () => text.errors.noSlashHandler,
  INTERNAL_ERROR: () => text.errors.internalError,
  UNAVAILABLE: () => text.errors.toolUnavailable,
  NONZERO_EXIT: () => text.errors.nonzeroExit,
  TOOL_NOT_FOUND: () => text.errors.toolNotFound,
  MALFORMED_TOOL_CALL: () => text.errors.malformedToolCall,
  INVALID_TOOL_ARGUMENTS_JSON: () => text.errors.invalidToolArguments,
  BUDGET_CONCURRENCY: () => text.errors.toolBudgetConcurrency,
  TOOL_CALL_BUDGET_EXCEEDED: () => text.errors.toolCallBudgetExceeded,
  PPD_TOOL_RESULT_MISSING: () => text.errors.ppdToolResultMissing,
  TECHNICAL_ERROR: () => text.errors.technicalError,
};

function mapKnownErrorCode(code: string): string | undefined {
  if (code.startsWith('LLM_')) return mapLlmCodeToMessage(code);
  if (code.startsWith('CONFIG_')) return text.config.error(code);
  const lookup = CODE_MESSAGE_MAP[code];
  return lookup ? lookup() : undefined;
}

export function mapErrorForDisplay(input: ErrorDisplayInput): ErrorDisplayOutput {
  const rawMessage = input.message ?? '';
  const mappedByMessage =
    mapUsageErrorMessage(rawMessage, input.code) ?? mapMessageToken(rawMessage);
  const mappedByCode = input.code ? mapKnownErrorCode(input.code) : undefined;
  const mapped = mappedByMessage ?? mappedByCode;
  const isRedacted = rawMessage === REDACTED_ERROR_TOKEN;

  if (isRedacted) {
    if (mapped) {
      return {
        message: mapped,
        code: input.code,
        redacted: true,
      };
    }
    return {
      message: text.errors.technicalDetailsHidden,
      code: input.code,
      redacted: true,
    };
  }

  if (mapped) {
    return {
      message: mapped,
      code: input.code,
      redacted: false,
    };
  }

  return {
    message: rawMessage,
    code: input.code,
    redacted: false,
  };
}

function mapErrorCategory(code?: string): string {
  if (!code) return 'unknown';
  if (code.startsWith('CONFIG_')) return 'config';
  if (code.startsWith('PREFLIGHT_')) return 'preflight';
  if (code === 'VERIFY_FAILED') return 'verify';
  if (code.startsWith('AUTH_')) return 'auth';
  if (code.startsWith('LLM_')) return 'llm';
  return 'unknown';
}

export function mapErrorForAudit(input: ErrorDisplayInput): ErrorAuditOutput {
  const rawMessage = input.message ?? '';
  const isRedacted = rawMessage === REDACTED_ERROR_TOKEN;
  const display = mapErrorForDisplay(input);
  const summary = isRedacted ? text.errors.technicalDetailsHidden : display.message;

  return {
    summary,
    category: mapErrorCategory(input.code),
    code: input.code,
    redacted: isRedacted || display.redacted,
  };
}

function buildLangfuseHttpFailed(details: unknown): ErrorAuditOutput | undefined {
  const status = typeof (details as any)?.status === 'number' ? (details as any).status : undefined;
  if (!status) return undefined;
  if (status === 401 || status === 403) {
    return {
      summary: `Langfuse ingestion unauthorized (HTTP ${status})`,
      category: 'auth',
      redacted: false,
    };
  }
  if (status >= 500) {
    return {
      summary: `Langfuse ingestion failed (HTTP ${status})`,
      category: 'network',
      redacted: false,
    };
  }
  if (status >= 400) {
    return {
      summary: `Langfuse ingestion failed (HTTP ${status})`,
      category: 'config',
      redacted: false,
    };
  }
  return {
    summary: `Langfuse ingestion failed (HTTP ${status})`,
    category: 'unknown',
    redacted: false,
  };
}

export function mapAuditTrailToError(
  events: AuditTrailEvent[],
): ErrorAuditOutput | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.action === 'langfuse.outcome.http_failed') {
      return buildLangfuseHttpFailed(event.details);
    }
    if (event.action === 'langfuse.outcome.request_failed') {
      return {
        summary: 'Langfuse ingestion request failed',
        category: 'network',
        redacted: false,
      };
    }
  }
  return undefined;
}
