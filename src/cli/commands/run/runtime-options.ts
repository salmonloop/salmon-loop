import { getLogger } from '../../../core/facades/cli-observability.js';
import { text } from '../../locales/index.js';
import { resolveLlmOutputPolicyFromCli } from '../../utils/llm-output.js';
import { resolveVerifyOption } from '../../utils/verify-resolver.js';
import { resolveWorktreePrepareOption } from '../../utils/worktree-prepare-resolver.js';

export async function resolveRunRuntimeOptions(params: {
  repoPath: string;
  resolvedConfig: any;
  cliOptions: any;
  outputFormat: 'text' | 'json' | 'stream-json';
  writeJsonFailure: (args: { message: string; repoPath?: string }) => void;
}): Promise<
  | { ok: true; llmOutput: any; effectiveVerify?: string; effectiveWorktreePrepare?: string }
  | { ok: false; exitCode: 1 }
> {
  const llmOutputResolution = resolveLlmOutputPolicyFromCli(
    params.resolvedConfig.llmOutput,
    params.cliOptions.llmOutput,
  );
  if (!llmOutputResolution.ok) {
    getLogger().error(text.cli.invalidLlmOutputKind(llmOutputResolution.invalid));
    if (params.outputFormat === 'json') {
      params.writeJsonFailure({
        message: text.cli.invalidLlmOutputKind(llmOutputResolution.invalid),
        repoPath: params.repoPath,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  const llmOutput = {
    ...llmOutputResolution.policy,
    kinds: [...llmOutputResolution.policy.kinds],
  };

  const wantPartialMessages = Boolean(
    params.cliOptions.streamOutput || params.cliOptions.includePartialMessages,
  );
  if (wantPartialMessages && !llmOutput.kinds.includes('plan')) {
    llmOutput.kinds.push('plan');
  }

  const effectiveVerify = await resolveVerifyOption(
    params.repoPath,
    params.cliOptions.verify,
    params.resolvedConfig.verify.command,
  );

  const effectiveWorktreePrepare = await resolveWorktreePrepareOption(
    params.repoPath,
    params.cliOptions.checkpointStrategy,
    params.cliOptions.worktreePrepare,
  );

  return { ok: true, llmOutput, effectiveVerify, effectiveWorktreePrepare };
}
