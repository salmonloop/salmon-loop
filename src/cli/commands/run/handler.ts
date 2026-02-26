import { randomUUID } from 'crypto';

import type { Command } from 'commander';

import { logger } from '../../../core/observability/logger.js';
import { getExitCode } from '../../../core/runtime/exit-codes.js';
import type { ChatSessionManager } from '../../../core/session/manager.js';
import {
  buildSessionConversationContext,
  getDefaultSessionContextBudgetTokens,
} from '../../../core/session/session-context-builder.js';
import { ApplyBackOnDirty, CheckpointStrategy, LoopResult } from '../../../core/types/index.js';
import { createStdoutWriter } from '../../headless/stdout-writer.js';
import { text } from '../../locales/index.js';
import { StderrLogReporter } from '../../reporters/stderr-log-reporter.js';

import { buildRunAssistantMessage } from './assistant-message.js';
import { resolveRunConfig } from './config-resolution.js';
import { handleEarlyRunCommandErrors } from './early-errors.js';
import { executeRunLoop } from './execute.js';
import { resolveRunExtensions } from './extensions-resolution.js';
import { createHeadlessErrorWriter } from './headless-error-writer.js';
import { ensureInstructionOrExit } from './instruction-guard.js';
import { buildRunLoopParams } from './loop-params.js';
import { resolveRunMode } from './mode.js';
import { createOutcomeReporter } from './outcome-reporter.js';
import { parseRunCommandOptions } from './parse-options.js';
import { persistRunSession } from './persist-session.js';
import { PreflightPolicy, runPreflight } from './preflight.js';
import { createRunReporter } from './reporter-factory.js';
import { createRuntimeLlmAndWarn } from './runtime-llm.js';
import { resolveRunRuntimeOptions } from './runtime-options.js';
import { initializeSession } from './session.js';
import { buildStructuredOutputState, type StructuredOutputState } from './structured-output.js';
import { logRunVerboseSummary, resolveVerboseLevel } from './verbose.js';

export async function handleRunCommand(options: any, command: Command) {
  const parsed = parseRunCommandOptions(command);
  const allOptions = parsed.allOptions;
  const runPath = parsed.repoPath;
  const continueSession = parsed.continueSession;
  const resumeSessionId = parsed.resumeSessionId;
  const printInstruction = parsed.printInstruction;
  const explicitInstruction = parsed.explicitInstruction;
  const jsonSchemaSpec = parsed.jsonSchemaSpec;

  const rawOutputFormat = parsed.rawOutputFormat;
  if (
    rawOutputFormat !== 'text' &&
    rawOutputFormat !== 'stream-json' &&
    rawOutputFormat !== 'json'
  ) {
    logger.error(text.cli.invalidOutputFormat(rawOutputFormat), true);
    process.exit(1);
  }

  const outputFormat = rawOutputFormat as 'text' | 'stream-json' | 'json';
  const headlessOutput = outputFormat !== 'text';
  const rawOutputProfile = parsed.rawOutputProfile;
  const outputProfileForStreamJson = parsed.outputProfileForStreamJson;
  const headlessIncludeToolInput = parsed.headlessIncludeToolInput;
  const headlessIncludeToolOutput = parsed.headlessIncludeToolOutput;
  const headlessIncludeAuthorizationDecisions = parsed.headlessIncludeAuthorizationDecisions;
  const stdoutWriter = createStdoutWriter();

  const instruction = parsed.instruction;
  const printMode = Boolean(printInstruction);
  const useGui = !headlessOutput && !printMode && allOptions.gui !== false && process.stdout.isTTY;

  if (headlessOutput) {
    logger.setReporter(new StderrLogReporter());
  }

  const wantSessionPersistence =
    !allOptions.printConfig &&
    (headlessOutput ||
      continueSession ||
      Boolean(resumeSessionId) ||
      typeof instruction === 'string');

  let sessionManager: ChatSessionManager | undefined;
  let sessionIdForOutput: string | undefined;

  const headlessErrorWriter = createHeadlessErrorWriter({
    repoPath: runPath,
    outputFormat,
    outputProfileForStreamJson,
    writer: stdoutWriter,
    getSessionId: () => sessionIdForOutput,
    getResumeSessionId: () => resumeSessionId,
  });

  const earlyError = handleEarlyRunCommandErrors({
    headlessOutput,
    outputFormat,
    rawOutputProfile,
    outputProfileForStreamJson,
    headlessIncludeToolInput,
    headlessIncludeToolOutput,
    headlessIncludeAuthorizationDecisions,
    instruction,
    printInstruction,
    explicitInstruction,
    continueSession,
    resumeSessionId,
    jsonSchemaSpec,
    sessionIdForOutput,
    headlessErrorWriter,
  });
  if (!earlyError.ok) {
    process.exitCode = earlyError.exitCode;
    return;
  }

  if (wantSessionPersistence) {
    try {
      const initialized = await initializeSession({
        repoPath: runPath,
        continueSession,
        resumeSessionId,
      });
      sessionManager = initialized.sessionManager;
      sessionIdForOutput = initialized.sessionId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (outputFormat !== 'text') {
        if (resumeSessionId) {
          headlessErrorWriter.writeUsageError({
            sessionId: resumeSessionId,
            instruction,
            message: msg,
          });
        } else {
          headlessErrorWriter.writeUnexpectedError({
            sessionId: sessionIdForOutput,
            instruction,
            message: msg,
          });
        }
      } else {
        logger.error(msg);
      }
      process.exitCode = 1;
      return;
    }
  }
  const allowedToolRules = parsed.allowedToolRules;
  const disallowedToolRules = parsed.disallowedToolRules;

  const rawPreflightPolicy = String((allOptions as any).preflightPolicy || 'lenient');
  if (rawPreflightPolicy !== 'lenient' && rawPreflightPolicy !== 'strict') {
    logger.error(text.cli.invalidPreflightPolicy(rawPreflightPolicy), true);
    return;
  }
  const preflightPolicy = rawPreflightPolicy as PreflightPolicy;

  await runPreflight({
    repoPath: runPath,
    validate: Boolean(allOptions.validate),
    useGui,
    preflightPolicy,
  });
  if (allOptions.validate && !instruction) return;

  const writeJsonFailure = (params: {
    exitCode?: number;
    message: string;
    errorCode?: string;
    repoPath?: string;
    instruction?: string;
  }) => {
    headlessErrorWriter.writeJsonFailure({
      exitCode: params.exitCode,
      message: params.message,
      errorCode: params.errorCode,
      repoPath: params.repoPath,
      instruction: params.instruction,
      sessionId: sessionIdForOutput ?? randomUUID(),
    });
  };

  const configResult = await resolveRunConfig({
    repoPath: runPath,
    cliOptions: allOptions,
    outputFormat,
    writeJsonFailure: ({ message, errorCode, repoPath }) =>
      writeJsonFailure({ message, errorCode, repoPath }),
  });
  if (!configResult.ok) {
    process.exitCode = 1;
    return;
  }
  if ('printedConfig' in configResult) return;
  const resolvedConfig = configResult.resolvedConfig;

  const runtimeOptions = await resolveRunRuntimeOptions({
    repoPath: runPath,
    resolvedConfig,
    cliOptions: allOptions,
    outputFormat,
    writeJsonFailure: ({ message, repoPath }) => writeJsonFailure({ message, repoPath }),
  });
  if (!runtimeOptions.ok) {
    process.exitCode = runtimeOptions.exitCode;
    return;
  }

  const llmOutput = runtimeOptions.llmOutput;
  const effectiveVerify = runtimeOptions.effectiveVerify;

  const instructionGuard = ensureInstructionOrExit({
    command,
    instruction,
    validate: Boolean(allOptions.validate),
    outputFormat,
    sessionIdForOutput,
    writeJsonFailure: ({ message, repoPath }) => writeJsonFailure({ message, repoPath }),
    repoPath: runPath,
    headlessErrorWriter,
  });
  if (!instructionGuard.ok) {
    process.exitCode = instructionGuard.exitCode;
    return;
  }

  const instructionText = instruction as string;

  const rawMode = String(allOptions.mode || 'patch');
  const mode = resolveRunMode(rawMode);
  if (!mode) {
    logger.error(text.cli.invalidMode(rawMode));
    if (outputFormat === 'json') {
      writeJsonFailure({ message: text.cli.invalidMode(rawMode), repoPath: runPath });
    } else if (outputFormat === 'stream-json') {
      headlessErrorWriter.writeUsageError({
        sessionId: sessionIdForOutput ?? randomUUID(),
        message: text.cli.invalidMode(rawMode),
        instruction,
      });
    }
    process.exitCode = 1;
    return;
  }

  const extensionsResult = await resolveRunExtensions({
    repoPath: runPath,
    outputFormat,
    writeJsonFailure: ({ message, repoPath }) => writeJsonFailure({ message, repoPath }),
  });
  if (!extensionsResult.ok) {
    process.exitCode = 1;
    return;
  }
  const extensionResolution = extensionsResult.extensionResolution;

  if (!effectiveVerify) {
    logger.warn(text.verify.noCommandFound);
  }

  const verboseLevel = resolveVerboseLevel(allOptions.verbose);
  logRunVerboseSummary({
    verboseLevel,
    instruction: instructionText,
    verify: effectiveVerify,
    repoPath: runPath,
    file: allOptions.file,
    selection: allOptions.selection,
    allowedToolRules,
    disallowedToolRules,
    dryRun: allOptions.dryRun,
    configPath: resolvedConfig.source.used ? resolvedConfig.source.path || '' : undefined,
  });

  try {
    const { llm } = createRuntimeLlmAndWarn({
      llmConfig: resolvedConfig.llm,
      langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
    });

    let structuredOutputState: StructuredOutputState = { ok: true, candidate: null };

    const reporter = createRunReporter({
      useGui,
      outputFormat,
      rawOutputProfile,
      repoPath: runPath,
      sessionIdForOutput,
      writer: stdoutWriter,
      verbose: Boolean(allOptions.verbose),
      model: resolvedConfig.llm.models?.selectedModelId,
      getStructuredOutput: () =>
        structuredOutputState.ok ? structuredOutputState.candidate : null,
      getPayloadOverrides: () => {
        if (structuredOutputState.ok) return undefined;
        const reason =
          structuredOutputState.errorCode === 'SCHEMA_INVALID'
            ? (structuredOutputState.errorReason ?? text.cli.structuredOutputSchemaFailed)
            : text.cli.structuredOutputSchemaFailed;
        return {
          success: false,
          exitCode: 1,
          reason,
          reasonCode: 'SCHEMA_VALIDATION_FAILED',
          errorCode: structuredOutputState.errorCode ?? 'SCHEMA_VALIDATION_FAILED',
          structuredOutputError: structuredOutputState.errorReason,
        };
      },
    });

    reporter.onStart(instructionText);

    const applyBackOnDirty = allOptions.applyBackOnDirty === 'abort' ? 'abort' : '3way';

    const outcomeReporter = createOutcomeReporter({
      enabled: resolvedConfig.observability.langfuse.outcome,
      endpoint: resolvedConfig.observability.langfuse.endpoint,
      llmBaseUrl: resolvedConfig.llm.api.baseUrl,
      llmApiKey: resolvedConfig.llm.api.apiKey,
      proxyApiKeyEnv: process.env.SALMONLOOP_LANGFUSE_PROXY_API_KEY,
    });

    const modelIdForBudget =
      llm.getModelId?.() ||
      resolvedConfig.llm.models?.selectedModelId ||
      process.env.SALMONLOOP_MODEL ||
      process.env.S8P_MODEL;

    const shouldInjectSessionContext = Boolean(continueSession || resumeSessionId);
    const conversationContext =
      shouldInjectSessionContext && sessionManager
        ? buildSessionConversationContext(sessionManager.getMessages(), {
            budgetTokens: getDefaultSessionContextBudgetTokens({ modelId: modelIdForBudget }),
          })
        : [];

    const loopParams = buildRunLoopParams({
      instruction: instructionText,
      verify: effectiveVerify,
      repoPath: runPath,
      llm,
      conversationContext: conversationContext.length > 0 ? conversationContext : undefined,
      mode,
      dryRun: allOptions.dryRun,
      forceReset: allOptions.forceReset,
      file: allOptions.file,
      selection: allOptions.selection,
      verbose: verboseLevel,
      checkpointStrategy: allOptions.checkpointStrategy as CheckpointStrategy,
      applyBackOnDirty,
      worktreePrepare: allOptions.worktreePrepare,
      llmOutput,
      outcomeReporter,
      langfuseSessionId: resolvedConfig.observability.langfuse.sessionId || sessionIdForOutput,
      langfuseUserId: resolvedConfig.observability.langfuse.userId,
      astValidation: resolvedConfig.astValidation,
      toolAuthorization: resolvedConfig.toolAuthorization,
      extensions: extensionResolution?.resolved,
      headlessOutput,
      printMode,
      headlessIncludeToolInput,
      headlessIncludeToolOutput,
      headlessIncludeAuthorizationDecisions,
      permissionRules:
        allowedToolRules.length > 0 || disallowedToolRules.length > 0
          ? { allow: allowedToolRules, deny: disallowedToolRules }
          : undefined,
    });

    const buildAssistantMessage = (result: LoopResult) =>
      buildRunAssistantMessage({ mode, result });

    const result = await executeRunLoop({
      useGui,
      loopParams,
      applyBackOnDirty: loopParams.applyBackOnDirty as ApplyBackOnDirty,
      reporter,
      llmOutput,
      buildAssistantMessage,
      toolAuthorizationConfig: resolvedConfig.toolAuthorization,
      guiConfig: {
        markdownTheme: resolvedConfig.markdownTheme,
        markdownRenderMode: resolvedConfig.markdownRenderMode,
        logView: resolvedConfig.ui.logView,
        logMode: resolvedConfig.ui.logMode,
      },
    });

    structuredOutputState = await buildStructuredOutputState({
      outputFormat,
      jsonSchemaSpec,
      result,
      repoPath: runPath,
      instruction: instructionText,
      sessionIdForOutput,
      exitCode: getExitCode(result),
      reasonCode: result.reasonCode,
    });
    if (
      !structuredOutputState.ok &&
      structuredOutputState.errorKind === 'schema_invalid' &&
      structuredOutputState.errorReason
    ) {
      structuredOutputState.errorReason = text.cli.jsonSchemaLoadFailed(
        structuredOutputState.errorReason,
      );
    }

    reporter.onFinish(result);

    await persistRunSession({
      sessionManager,
      instruction: instructionText,
      result,
      buildAssistantMessage,
    });

    process.exitCode = headlessErrorWriter.writeResultExitCode(result, structuredOutputState.ok);
    return;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(text.cli.unexpectedError(msg), false);
    if (outputFormat === 'json') {
      writeJsonFailure({
        message: text.cli.unexpectedError(msg),
        repoPath: runPath,
        instruction,
      });
    } else if (outputFormat === 'stream-json') {
      headlessErrorWriter.writeUnexpectedError({
        sessionId: sessionIdForOutput ?? resumeSessionId ?? randomUUID(),
        message: text.cli.unexpectedError(msg),
      });
    }
    process.exitCode = 1;
    return;
  }
}
