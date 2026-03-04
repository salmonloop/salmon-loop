import { execa } from 'execa';
import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { Phase } from '../../types/runtime.js';
import { getPlatformShellInvocation } from '../../utils/platform-shell.js';
import { processResource, repoResource } from '../parallel/resource-helpers.js';
import type { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const shellExecSpec: Omit<ToolSpec, 'executor'> = {
  name: 'shell.exec',
  source: 'builtin',
  intent: 'INFRA',
  description: text.tools.shellExecDescription,
  riskLevel: 'high',
  sideEffects: ['process'],
  concurrency: 'isolated',
  computeResources: (_input, ctx) => [repoResource(ctx), processResource(ctx)],
  allowedPhases: [Phase.SLASH],
  inputSchema: z.object({
    command: z.string().min(1).describe('Shell command to execute'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().nullable(),
  }),
  summarizeArgsForAuthorization: async (args: { command: string }, ctx) => {
    const cwd = ctx.worktreeRoot || ctx.repoRoot;
    return `command=${JSON.stringify(args.command)} cwd=${JSON.stringify(cwd)}`;
  },
};

export async function executeShellExec(
  input: z.infer<typeof shellExecSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const cwd = ctx.worktreeRoot || ctx.repoRoot;
  if (ctx.dryRun) {
    return {
      ok: true,
      stdout: `[DRY_RUN] ${input.command}`,
      stderr: '',
      exitCode: 0,
    };
  }

  try {
    const shell = getPlatformShellInvocation(input.command);
    const res = await execa(shell.file, shell.args, {
      cwd,
      env: {
        ...process.env,
        ...(ctx.env ?? {}),
        SALMONLOOP_REPO_ROOT: ctx.repoRoot,
        SALMONLOOP_WORKTREE_ROOT: ctx.worktreeRoot ?? '',
        SALMONLOOP_ATTEMPT_ID: String(ctx.attemptId),
      },
      reject: false,
    });

    return {
      ok: res.exitCode === 0,
      stdout: (res.stdout ?? '').trim(),
      stderr: (res.stderr ?? '').trim(),
      exitCode: res.exitCode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stdout: '',
      stderr: message,
      exitCode: null,
    };
  }
}
