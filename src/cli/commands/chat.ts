import { resolve } from 'path';

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
  resolveConfig,
  resolveExtensions,
} from '../../core/facades/cli-command-chat.js';
import { text } from '../locales/index.js';
import { resolveAuditScope } from '../utils/audit-scope.js';
import { resolveLlmOutputPolicyFromCli } from '../utils/llm-output.js';
import { createOutcomeReporter } from '../utils/outcome-reporter.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleChatCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
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

  const resolvedConfig = await resolveConfig({
    repoRoot: runPath,
    enableConfigFile: true,
  });
  const auditScopeResolution = resolveAuditScope({
    cliValue: allOptions.auditScope,
    configValue: resolvedConfig.observability.audit.scope,
  });
  if (!auditScopeResolution.ok) {
    getLogger().error(text.cli.invalidAuditScope(auditScopeResolution.invalid), true);
    process.exit(1);
  }
  const auditScope = auditScopeResolution.value;
  const rawPermissionMode = allOptions.mode ?? resolvedConfig.permissionMode ?? 'interactive';
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
      checkpointStrategy:
        permissionMode === 'yolo' &&
        typeof command.getOptionValueSource === 'function' &&
        command.getOptionValueSource('checkpointStrategy') !== 'cli'
          ? 'direct'
          : allOptions.checkpointStrategy || 'worktree',
      continue: continueSession,
      resumeSessionId,
      verbose: allOptions.verbose,
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
