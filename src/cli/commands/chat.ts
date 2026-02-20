import { resolve } from 'path';

import { Command } from 'commander';

import { resolveConfig } from '../../core/config/index.js';
import { resolveExtensions } from '../../core/extensions/index.js';
import { createRuntimeLlm } from '../../core/llm/factory.js';
import { logger } from '../../core/observability/logger.js';
import { PluginLoader } from '../../core/plugin/loader.js';
import { LiteLlmLangfuseOutcomeReporter } from '../../integrations/langfuse/litellm-langfuse-outcome-reporter.js';
import { resolveLangfuseOutcomeProxyBaseUrl } from '../../integrations/langfuse/outcome-proxy.js';
import { text } from '../locales/index.js';
import { resolveLlmOutputPolicyFromCli } from '../utils/llm-output.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleChatCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const continueSession = Boolean((allOptions as any).continue);
  const resumeSessionId =
    typeof (allOptions as any).resume === 'string'
      ? ((allOptions as any).resume as string)
      : undefined;

  if (continueSession && resumeSessionId) {
    logger.error(text.cli.continueResumeConflict, true);
    process.exit(1);
  }

  // Initialize plugins (including user plugins from .salmonloop/languages)
  await PluginLoader.loadPlugins(runPath);

  const resolvedConfig = await resolveConfig({
    repoRoot: runPath,
    enableConfigFile: true,
  });

  const llmOutputResolution = resolveLlmOutputPolicyFromCli(
    resolvedConfig.llmOutput,
    allOptions.llmOutput,
  );
  if (!llmOutputResolution.ok) {
    logger.error(text.cli.invalidLlmOutputKind(llmOutputResolution.invalid), true);
    process.exitCode = 1;
    return;
  }
  const llmOutput = llmOutputResolution.policy;

  const { llm } = createRuntimeLlm(resolvedConfig.llm, {
    langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
  });

  const outcomeReporter = (() => {
    const resolved = resolveLangfuseOutcomeProxyBaseUrl({
      enabled: resolvedConfig.observability.langfuse.outcome,
      endpoint: resolvedConfig.observability.langfuse.endpoint,
      llmBaseUrl: resolvedConfig.llm.api.baseUrl,
    });
    if (!resolved.enabled || !resolved.proxyBaseUrl) return undefined;
    const proxyApiKey =
      (process.env.SALMONLOOP_LANGFUSE_PROXY_API_KEY || '').trim() || resolvedConfig.llm.api.apiKey;
    return new LiteLlmLangfuseOutcomeReporter({
      proxyBaseUrl: resolved.proxyBaseUrl,
      proxyPathPrefix: resolved.proxyPathPrefix,
      litellmApiKey: proxyApiKey,
    });
  })();

  // Smart verification resolution with auto-detection
  const verifyCommand = await resolveVerifyOption(
    runPath,
    allOptions.verify,
    resolvedConfig.verify.command,
  );

  // Verification is now optional - the loop will skip if undefined
  if (!verifyCommand) {
    logger.warn(text.verify.noCommandFound);
  }

  // Dynamic import to avoid circular dependencies if any, and keep startup fast
  const { startChatMode } = await import('../chat.js');
  const extensionResolution = await resolveExtensions({ repoRoot: runPath });

  try {
    await startChatMode({
      repoPath: runPath,
      llm,
      verifyCommand,
      checkpointStrategy: allOptions.checkpointStrategy || 'worktree',
      continue: continueSession,
      resumeSessionId,
      verbose: allOptions.verbose,
      llmOutput,
      markdownTheme: resolvedConfig.markdownTheme,
      markdownRenderMode: resolvedConfig.markdownRenderMode,
      uiLogView: resolvedConfig.ui.logView,
      uiLogMode: resolvedConfig.ui.logMode,
      toolAuthorization: resolvedConfig.toolAuthorization,
      extensions: extensionResolution.resolved,
      outcomeReporter,
      langfuseSessionId: resolvedConfig.observability.langfuse.sessionId,
      langfuseUserId: resolvedConfig.observability.langfuse.userId,
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg, true);
    process.exit(1);
  }
}
