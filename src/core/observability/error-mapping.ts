import { text } from '../../locales/index.js';

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
  resource_lock_error: () => text.errors.resourceLockError,
  ast_validation_error: () => text.errors.astValidationError,
  unknown: () => text.errors.unknownError,
  TIMEOUT: () => text.errors.timeout,
  RUNTIME_ERROR: () => text.errors.runtimeError,
};

function mapKnownErrorCode(code: string): string | undefined {
  if (code.startsWith('LLM_')) return mapLlmCodeToMessage(code);
  if (code.startsWith('CONFIG_')) return text.config.error(code);
  const lookup = CODE_MESSAGE_MAP[code];
  return lookup ? lookup() : undefined;
}

export function mapErrorForDisplay(input: ErrorDisplayInput): ErrorDisplayOutput {
  const rawMessage = input.message ?? '';
  const mappedByCode = input.code ? mapKnownErrorCode(input.code) : undefined;
  const isRedacted = rawMessage === REDACTED_ERROR_TOKEN;

  if (isRedacted) {
    if (mappedByCode) {
      return {
        message: mappedByCode,
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

  if (mappedByCode) {
    return {
      message: mappedByCode,
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
