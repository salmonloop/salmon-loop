import { randomUUID } from 'crypto';

import { Command } from 'commander';

import { createRuntimeLlm } from '../../core/llm/factory.js';
import { logger } from '../../core/observability/logger.js';
import { getExitCode } from '../../core/runtime/exit-codes.js';
import type { ChatSessionManager } from '../../core/session/manager.js';
import { CheckpointStrategy, ApplyBackOnDirty, LoopResult } from '../../core/types/index.js';
import { createTerminalAuthorizationProvider } from '../authorization/provider.js';
import { createStdoutWriter } from '../headless/stdout-writer.js';
import { text } from '../locales/index.js';
import { StderrLogReporter } from '../reporters/stderr-log-reporter.js';
import { resolveLlmOutputPolicyFromCli } from '../utils/llm-output.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

import { buildRunAssistantMessage } from './run/assistant-message.js';
import { resolveRunConfig } from './run/config-resolution.js';
import { executeRunLoop } from './run/execute.js';
import { resolveRunExtensions } from './run/extensions-resolution.js';
import { createHeadlessErrorWriter } from './run/headless-error-writer.js';
import { resolveRunMode } from './run/mode.js';
import { createOutcomeReporter } from './run/outcome-reporter.js';
import { parseRunCommandOptions } from './run/parse-options.js';
import { persistRunSession } from './run/persist-session.js';
import { runPreflight } from './run/preflight.js';
import { createRunReporter } from './run/reporter-factory.js';
import { initializeSession } from './run/session.js';
import { buildStructuredOutputState, type StructuredOutputState } from './run/structured-output.js';
import { logRunVerboseSummary, resolveVerboseLevel } from './run/verbose.js';

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
  const stdoutWriter = createStdoutWriter();

  const instruction = parsed.instruction;
  const printMode = Boolean(printInstruction);
  const useGui = !headlessOutput && !printMode && allOptions.gui !== false && process.stdout.isTTY;

  if (headlessOutput) {
    // Ensure stdout is reserved for machine-readable output.
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

  if (explicitInstruction && printInstruction) {
    if (headlessOutput) {
      logger.error(text.cli.printInstructionConflict);
      headlessErrorWriter.writeUsageError({
        message: text.cli.printInstructionConflict,
        instruction: printInstruction,
      });
      process.exitCode = 1;
      return;
    }
    logger.error(text.cli.printInstructionConflict, true);
  }

  if (continueSession && resumeSessionId) {
    if (headlessOutput) {
      logger.error(text.cli.continueResumeConflict);
      headlessErrorWriter.writeUsageError({
        message: text.cli.continueResumeConflict,
        sessionId: resumeSessionId,
        instruction,
      });
      process.exitCode = 1;
      return;
    }
    logger.error(text.cli.continueResumeConflict, true);
  }

  if (rawOutputProfile && outputFormat !== 'stream-json') {
    logger.error(text.cli.outputProfileRequiresStreamJson);
    if (outputFormat === 'json') {
      headlessErrorWriter.writeJsonFailure({
        repoPath: runPath,
        sessionId: sessionIdForOutput ?? randomUUID(),
        instruction,
        message: text.cli.outputProfileRequiresStreamJson,
        exitCode: 1,
      });
    }
    process.exitCode = 1;
    return;
  }

  if (outputFormat === 'stream-json') {
    const outputProfile = outputProfileForStreamJson;
    if (outputProfile !== 'native' && outputProfile !== 'anthropic' && outputProfile !== 'openai') {
      logger.error(text.cli.invalidOutputProfile(outputProfile));
      headlessErrorWriter.writeUnexpectedError({
        sessionId: sessionIdForOutput ?? resumeSessionId ?? randomUUID(),
        message: text.cli.invalidOutputProfile(outputProfile),
      });
      process.exitCode = 1;
      return;
    }

    if (outputProfile === 'openai') {
      logger.error(text.cli.outputProfileNotSupportedYet(outputProfile));
      headlessErrorWriter.writeUnexpectedError({
        sessionId: sessionIdForOutput ?? resumeSessionId ?? randomUUID(),
        message: text.cli.outputProfileNotSupportedYet(outputProfile),
      });
      process.exitCode = 1;
      return;
    }
  }

  if (jsonSchemaSpec && outputFormat !== 'json') {
    logger.error(text.cli.jsonSchemaRequiresJsonOutput);
    if (outputFormat === 'stream-json') {
      headlessErrorWriter.writeUnexpectedError({
        sessionId: sessionIdForOutput ?? randomUUID(),
        message: text.cli.jsonSchemaRequiresJsonOutput,
        instruction,
      });
    }
    process.exitCode = 1;
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
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (resumeSessionId && outputFormat !== 'text') {
        headlessErrorWriter.writeUnexpectedError({
          sessionId: resumeSessionId,
          message: msg,
        });
      } else {
        logger.error(msg);
      }
      process.exitCode = 1;
      return;
    }
  }
  const allowedToolRules = parsed.allowedToolRules;
  const disallowedToolRules = parsed.disallowedToolRules;

  await runPreflight({ repoPath: runPath, validate: Boolean(allOptions.validate), useGui });
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

  const llmOutputResolution = resolveLlmOutputPolicyFromCli(
    resolvedConfig.llmOutput,
    allOptions.llmOutput,
  );
  if (!llmOutputResolution.ok) {
    logger.error(text.cli.invalidLlmOutputKind(llmOutputResolution.invalid));
    if (outputFormat === 'json') {
      writeJsonFailure({
        message: text.cli.invalidLlmOutputKind(llmOutputResolution.invalid),
        repoPath: runPath,
      });
      process.exitCode = 1;
      return;
    }
    process.exitCode = 1;
    return;
  }
  const llmOutput = {
    ...llmOutputResolution.policy,
    kinds: [...llmOutputResolution.policy.kinds],
  };

  // Smart verification resolution with auto-detection
  const effectiveVerify = await resolveVerifyOption(
    runPath,
    allOptions.verify,
    resolvedConfig.verify.command,
  );

  if (!instruction) {
    if (!allOptions.validate) {
      logger.error(text.cli.optionsRequired);
      if (outputFormat === 'text') {
        command.help(); // Show help if required options are missing
      }
      if (outputFormat === 'json') {
        writeJsonFailure({ message: text.cli.optionsRequired, repoPath: runPath });
      } else if (outputFormat === 'stream-json') {
        headlessErrorWriter.writeUnexpectedError({
          sessionId: sessionIdForOutput ?? randomUUID(),
          message: text.cli.optionsRequired,
        });
      }
      process.exitCode = 1;
      return;
    }
    return;
  }

  const rawMode = String(allOptions.mode || 'patch');
  const mode = resolveRunMode(rawMode);
  if (!mode) {
    logger.error(text.cli.invalidMode(rawMode));
    if (outputFormat === 'json') {
      writeJsonFailure({ message: text.cli.invalidMode(rawMode), repoPath: runPath });
    } else if (outputFormat === 'stream-json') {
      headlessErrorWriter.writeUnexpectedError({
        sessionId: sessionIdForOutput ?? randomUUID(),
        message: text.cli.invalidMode(rawMode),
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

  // Verification is now optional - warn if not found
  if (!effectiveVerify) {
    logger.warn(text.verify.noCommandFound);
  }

  const verboseLevel = resolveVerboseLevel(allOptions.verbose);
  logRunVerboseSummary({
    verboseLevel,
    instruction,
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
    const llmType = resolvedConfig.llm.type;
    const clientPackage = resolvedConfig.llm.clientPackage;

    const runtimeLlm = createRuntimeLlm(resolvedConfig.llm, {
      langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
    });
    const llm = runtimeLlm.llm;

    for (const w of runtimeLlm.warnings) {
      if (w === 'API_KEY_MISSING') {
        logger.warn(text.cli.apiKeyMissing);
      } else if (w === 'PROVIDER_NOT_SUPPORTED') {
        logger.warn(text.cli.providerNotSupported(llmType));
      } else if (w === 'CLIENT_PACKAGE_NOT_SUPPORTED') {
        logger.warn(text.cli.clientPackageNotSupported(clientPackage || ''));
      }
    }

    let structuredOutputState: StructuredOutputState = { ok: true, candidate: null };

    const reporter = createRunReporter({
      useGui,
      outputFormat,
      rawOutputProfile,
      repoPath: runPath,
      sessionIdForOutput,
      writer: stdoutWriter,
      verbose: Boolean(allOptions.verbose),
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

    reporter.onStart(instruction);

    const applyBackOnDirty = allOptions.applyBackOnDirty === 'abort' ? 'abort' : '3way';

    const wantPartialMessages = Boolean(
      allOptions.streamOutput || allOptions.includePartialMessages,
    );
    if (wantPartialMessages && !llmOutput.kinds.includes('plan')) {
      llmOutput.kinds.push('plan');
    }

    const outcomeReporter = createOutcomeReporter({
      enabled: resolvedConfig.observability.langfuse.outcome,
      endpoint: resolvedConfig.observability.langfuse.endpoint,
      llmBaseUrl: resolvedConfig.llm.api.baseUrl,
      llmApiKey: resolvedConfig.llm.api.apiKey,
      proxyApiKeyEnv: process.env.SALMONLOOP_LANGFUSE_PROXY_API_KEY,
    });

    const loopParams = {
      instruction,
      verify: effectiveVerify,
      repoPath: runPath,
      llm: llm,
      mode,
      dryRun: allOptions.dryRun,
      forceReset: allOptions.forceReset,
      file: allOptions.file,
      selection: allOptions.selection,
      verbose: verboseLevel,
      strategy: allOptions.checkpointStrategy as CheckpointStrategy,
      applyBackOnDirty,
      worktreePrepare: allOptions.worktreePrepare,
      llmOutput,
      outcomeReporter,
      langfuseSessionId: resolvedConfig.observability.langfuse.sessionId || sessionIdForOutput,
      langfuseUserId: resolvedConfig.observability.langfuse.userId,
      authorizationProvider: createTerminalAuthorizationProvider({
        config: resolvedConfig.toolAuthorization,
        extensions: extensionResolution?.resolved,
        forceNonInteractive: headlessOutput || printMode,
      }),
      extensions: extensionResolution?.resolved,
      permissionRules:
        allowedToolRules.length > 0 || disallowedToolRules.length > 0
          ? { allow: allowedToolRules, deny: disallowedToolRules }
          : undefined,
    };

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
      instruction,
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

    await persistRunSession({ sessionManager, instruction, result, buildAssistantMessage });

    process.exitCode = headlessErrorWriter.writeResultExitCode(result, structuredOutputState.ok);
    return;
  } catch (err: any) {
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
