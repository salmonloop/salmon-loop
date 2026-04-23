import { Command } from 'commander';

import {
  createPluginRegistry,
  createPromptRegistry,
  createRuntimeLlm,
  setPluginRegistry,
  setPromptRegistry,
  ExtensionConfigError,
  getLogger,
  normalizePermissionMode,
  PluginLoader,
  resolveExecutionProfile,
  resolveExtensions,
  type CheckpointStrategy,
  type FlowMode,
} from '../../core/facades/cli-command-chat.js';
import { text } from '../locales/index.js';
import { getOptionValueSourceWithGlobalFallback } from '../utils/command-option-source.js';
import { resolveLlmOutputPolicyFromCli } from '../utils/llm-output.js';
import { createOutcomeReporter } from '../utils/outcome-reporter.js';
import { resolveCliConfig } from '../utils/resolve-cli-config.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleChatCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const configResult = await resolveCliConfig({
    repo: allOptions.repo,
    cwd: process.cwd(),
    configPath: allOptions.config,
    enableConfigFile: allOptions.configFile !== false,
    auditScope: allOptions.auditScope,
    verbose: allOptions.verbose,
    logMode: allOptions.logMode,
  });
  if (!configResult.ok) {
    getLogger().error(configResult.message, true);
    process.exit(1);
  }
  const { resolvedConfig, auditScope, repoPath: runPath, verboseLevel } = configResult;
  const printInstruction =
    typeof (allOptions as any).print === 'string'
      ? ((allOptions as any).print as string)
      : undefined;
  const continueSession = Boolean((allOptions as any).continue);
  const resumeSessionId =
    typeof (allOptions as any).resume === 'string'
      ? ((allOptions as any).resume as string)
      : undefined;

  if (printInstruction) {
    getLogger().error(text.cli.printCommandConflict('chat'), true);
    process.exit(1);
  }

  if (continueSession && resumeSessionId) {
    getLogger().error(text.cli.continueResumeConflict, true);
    process.exit(1);
  }

  // Initialize plugins (including user plugins from .salmonloop/languages)
  const languagePlugins = createPluginRegistry();
  setPluginRegistry(languagePlugins);
  setPromptRegistry(createPromptRegistry());
  await PluginLoader.loadPlugins(languagePlugins, runPath);

  const defaultFlowMode: FlowMode = 'autopilot';
  const defaultFlowProfile = resolveExecutionProfile(defaultFlowMode);
  const modeOptionSource = getOptionValueSourceWithGlobalFallback(command, 'mode');
  const checkpointStrategyOptionSource = getOptionValueSourceWithGlobalFallback(
    command,
    'checkpointStrategy',
  );

  const rawPermissionMode =
    (modeOptionSource === 'cli' ? allOptions.mode : undefined) ??
    resolvedConfig.permissionMode ??
    defaultFlowProfile.defaultPermissionMode ??
    'interactive';
  const permissionMode = normalizePermissionMode(rawPermissionMode);
  if (!permissionMode) {
    getLogger().error(
      `Invalid --mode "${String(rawPermissionMode)}". Expected "interactive" or "yolo".`,
    );
    process.exit(1);
  }

  const llmOutputResolution = resolveLlmOutputPolicyFromCli(
    resolvedConfig.llmOutput,
    allOptions.llmOutput,
  );
  if (!llmOutputResolution.ok) {
    getLogger().error(text.cli.invalidLlmOutputKind(llmOutputResolution.invalid), true);
    process.exitCode = 1;
    return;
  }
  const llmOutput = llmOutputResolution.policy;

  const { llm } = createRuntimeLlm(resolvedConfig.llm, {
    langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
  });

  const outcomeReporter = createOutcomeReporter({
    enabled: resolvedConfig.observability.langfuse.outcome,
    endpoint: resolvedConfig.observability.langfuse.endpoint,
    llmBaseUrl: resolvedConfig.llm.api.baseUrl,
    langfuseApiKey: resolvedConfig.observability.langfuse.apiKey,
  });

  // Smart verification resolution with auto-detection
  const verifyCommand = await resolveVerifyOption(
    runPath,
    allOptions.verify,
    resolvedConfig.verify.command,
  );

  // Verification is now optional - the loop will skip if undefined
  if (!verifyCommand) {
    getLogger().warn(text.verify.noCommandFound);
  }

  // Dynamic import to avoid circular dependencies if any, and keep startup fast
  const { startChatMode } = await import('../chat.js');

  let extensionResolution;
  try {
    extensionResolution = await resolveExtensions({ repoRoot: runPath });
  } catch (err: unknown) {
    if (err instanceof ExtensionConfigError) {
      getLogger().error(`Extension configuration invalid: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  try {
    await startChatMode({
      repoPath: runPath,
      llm,
      verifyCommand,
      defaultFlowMode,
      checkpointStrategy:
        checkpointStrategyOptionSource === 'cli'
          ? (allOptions.checkpointStrategy as CheckpointStrategy) || 'worktree'
          : undefined,
      continue: continueSession,
      resumeSessionId,
      verbose: verboseLevel,
      llmOutput,
      markdownTheme: resolvedConfig.markdownTheme,
      markdownRenderMode: resolvedConfig.markdownRenderMode,
      uiLogView: resolvedConfig.ui.logView,
      uiLogMode: resolvedConfig.ui.logMode,
      astValidation: resolvedConfig.astValidation,
      toolAuthorization: resolvedConfig.toolAuthorization,
      permissionMode,
      extensions: extensionResolution.resolved,
      outcomeReporter,
      auditScope,
      langfuseSessionId: resolvedConfig.observability.langfuse.sessionId,
      langfuseUserId: resolvedConfig.observability.langfuse.userId,
      languagePlugins,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().error(msg, true);
    process.exit(1);
  }
}
