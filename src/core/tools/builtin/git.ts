import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { Phase } from '../../types.js';
import { repoResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const gitCatSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.cat',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.gitCatDescription,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    file: z.string().describe('Path to the file relative to repo root'),
    ref: z.string().default('HEAD').describe('Git reference (branch, hash, or HEAD)'),
  }),
  outputSchema: z.object({
    content: z.string(),
    file: z.string(),
    ref: z.string(),
  }),
  allowedPhases: [Phase.CONTEXT],
};

/**
 * Builtin tool to read file content from a specific git revision
 */
export async function executeGitCat(
  input: z.infer<typeof gitCatSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { file, ref } = input;

  // Safety check: ensure file path doesn't try to escape
  if (file.includes('..') || file.startsWith('/') || /^[a-zA-Z]:/.test(file)) {
    throw new Error(text.tools.invalidRelativePath(file));
  }

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(['show', `${ref}:${file}`], {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.showFailed(`code=${res.code ?? 'null'} ${res.stderr.trim()}`.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  return {
    content: res.stdout.toString('utf8'),
    file,
    ref,
  };
}

export const gitStatusSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.status',
  source: 'builtin',
  intent: 'LIST',
  description: text.tools.gitStatusDescription,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    porcelain: z.boolean().default(true).describe('Give the output in an easy-to-parse format'),
  }),
  outputSchema: z.object({
    status: z.string(),
  }),
  allowedPhases: [Phase.CONTEXT, Phase.PLAN, Phase.VERIFY],
};

/**
 * Builtin tool to check git status
 */
export async function executeGitStatus(
  input: z.infer<typeof gitStatusSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { porcelain } = input;
  const args = ['status'];
  if (porcelain) args.push('--porcelain');

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(args, {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.commandFailedDetailed(res.code, res.stderr.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  return {
    status: res.stdout.toString('utf8'),
  };
}
