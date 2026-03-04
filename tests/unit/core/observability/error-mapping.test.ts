import { describe, expect, it } from 'bun:test';

import { REDACTED_ERROR_TOKEN } from '../../../../src/core/observability/error-envelope.js';
import {
  mapAuditTrailToError,
  mapErrorForAudit,
  mapErrorForDisplay,
} from '../../../../src/core/observability/error-mapping.js';
import { text } from '../../../../src/locales/index.js';

describe('mapErrorForDisplay', () => {
  it('maps redacted token to localized message', () => {
    const result = mapErrorForDisplay({ message: REDACTED_ERROR_TOKEN });

    expect(result.message).toBe(text.errors.technicalDetailsHidden);
    expect(result.redacted).toBe(true);
  });

  it('maps LLM error codes to localized messages', () => {
    const result = mapErrorForDisplay({
      message: 'LLM request failed',
      code: 'LLM_HTTP_REQUEST_FAILED',
    });

    expect(result.message).toBe(text.llmErrors.httpRequestFailed);
    expect(result.code).toBe('LLM_HTTP_REQUEST_FAILED');
  });

  it('maps additional error codes to localized messages', () => {
    const preflight = mapErrorForDisplay({
      message: 'ERR_TECHNICAL_DETAILS_HIDDEN',
      code: 'PREFLIGHT_NOT_GIT',
    });
    const schema = mapErrorForDisplay({
      message: 'Schema invalid',
      code: 'SCHEMA_INVALID',
    });
    const lint = mapErrorForDisplay({
      message: 'Lint failed',
      code: 'lint',
    });
    const patchEmpty = mapErrorForDisplay({
      message: 'LLM patch empty',
      code: 'LLM_PATCH_EMPTY',
    });

    expect(preflight.message).toBe(text.errors.preflightNotGit);
    expect(preflight.redacted).toBe(true);
    expect(schema.message).toBe(text.errors.schemaInvalid);
    expect(lint.message).toBe(text.errors.lintFailed);
    expect(patchEmpty.message).toBe(text.llm.patchEmpty());
  });

  it('maps config error codes using config formatter', () => {
    const result = mapErrorForDisplay({
      message: 'Config failed',
      code: 'CONFIG_LLM_MODELS_REQUIRED',
    });

    expect(result.message).toBe(text.config.error('CONFIG_LLM_MODELS_REQUIRED'));
  });

  it('maps redacted errors to code-specific messages when available', () => {
    const result = mapErrorForDisplay({
      message: REDACTED_ERROR_TOKEN,
      code: 'noFilesRead',
    });

    expect(result.message).toBe(text.errors.noFilesRead);
    expect(result.redacted).toBe(true);
  });

  it('maps tool and output error codes to localized messages', () => {
    const toolParse = mapErrorForDisplay({
      message: 'tool parse failed',
      code: 'TOOL_PARSE_ERROR',
    });
    const outputParse = mapErrorForDisplay({
      message: 'output parse failed',
      code: 'OUTPUT_PARSE_FAILED',
    });
    const authRequired = mapErrorForDisplay({
      message: 'auth required',
      code: 'AUTH_REQUIRED',
    });

    expect(toolParse.message).toBe(text.errors.toolParseError);
    expect(outputParse.message).toBe(text.errors.outputParseFailed);
    expect(authRequired.message).toBe(text.errors.authRequired);
  });

  it('maps ask-user interruption error codes to localized messages', () => {
    const cancelled = mapErrorForDisplay({
      message: 'ask user cancelled',
      code: 'ASK_USER_CANCELLED',
    });
    const blocked = mapErrorForDisplay({
      message: 'ask user blocked',
      code: 'ASK_USER_SUBAGENT_BLOCKED',
    });

    expect(cancelled.message).toBe(text.errors.askUserCancelled);
    expect(blocked.message).toBe(text.errors.askUserSubagentBlocked);
  });

  it('maps tool routing and budget error codes to localized messages', () => {
    const notFound = mapErrorForDisplay({
      message: 'not found',
      code: 'TOOL_NOT_FOUND',
    });
    const malformed = mapErrorForDisplay({
      message: 'malformed tool call',
      code: 'MALFORMED_TOOL_CALL',
    });
    const invalidArgs = mapErrorForDisplay({
      message: 'invalid tool arguments',
      code: 'INVALID_TOOL_ARGUMENTS_JSON',
    });
    const budget = mapErrorForDisplay({
      message: 'budget',
      code: 'BUDGET_CONCURRENCY',
    });
    const technical = mapErrorForDisplay({
      message: 'technical',
      code: 'TECHNICAL_ERROR',
    });

    expect(notFound.message).toBe(text.errors.toolNotFound);
    expect(malformed.message).toBe(text.errors.malformedToolCall);
    expect(invalidArgs.message).toBe(text.errors.invalidToolArguments);
    expect(budget.message).toBe(text.errors.toolBudgetConcurrency);
    expect(technical.message).toBe(text.errors.technicalError);
  });

  it('maps USAGE_ERROR detail messages to localized messages', () => {
    const result = mapErrorForDisplay({
      message: 'PRINT_INSTRUCTION_CONFLICT',
      code: 'USAGE_ERROR',
    });

    expect(result.message).toBe(text.errors.usagePrintInstructionConflict);
  });

  it('maps allowlist and slash message tokens to localized messages', () => {
    const allowlist = mapErrorForDisplay({
      message: 'ALLOWLIST_PARSE_FAILED',
    });
    const slash = mapErrorForDisplay({
      message: 'UNKNOWN_SLASH',
    });

    expect(allowlist.message).toBe(text.errors.allowlistParseFailed);
    expect(slash.message).toBe(text.errors.unknownSlash);
  });

  it('keeps original message when no mapping applies', () => {
    const result = mapErrorForDisplay({
      message: 'Something went wrong',
      code: 'UNKNOWN_ERROR',
    });

    expect(result.message).toBe('Something went wrong');
    expect(result.redacted).toBe(false);
  });
});

describe('mapErrorForAudit', () => {
  it('maps redacted token to technical details hidden summary and marks redacted', () => {
    const result = mapErrorForAudit({ message: REDACTED_ERROR_TOKEN });

    expect(result.summary).toBe(text.errors.technicalDetailsHidden);
    expect(result.redacted).toBe(true);
    expect(result.category).toBe('unknown');
  });

  it('categorizes preflight and config errors', () => {
    const preflight = mapErrorForAudit({ message: 'x', code: 'PREFLIGHT_NOT_GIT' });
    const config = mapErrorForAudit({ message: 'x', code: 'CONFIG_LLM_MODELS_REQUIRED' });

    expect(preflight.category).toBe('preflight');
    expect(config.category).toBe('config');
  });

  it('maps Langfuse http_failed (401) to auth summary/category', () => {
    const result = mapAuditTrailToError([
      {
        action: 'langfuse.outcome.http_failed',
        details: { status: 401, statusText: 'Unauthorized' },
        timestamp: new Date().toISOString(),
      },
    ]);

    expect(result?.category).toBe('auth');
    expect(result?.summary).toContain('401');
  });
});
