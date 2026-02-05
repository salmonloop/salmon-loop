import { spawn } from 'child_process';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { Phase } from '../../types.js';
import { repoResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const gitCatSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.cat',
  source: 'builtin',
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

  return new Promise((resolve, reject) => {
    // Safety check: ensure file path doesn't try to escape
    if (file.includes('..') || file.startsWith('/') || /^[a-zA-Z]:/.test(file)) {
      return reject(new Error('Invalid file path: absolute paths and traversal are forbidden'));
    }

    const child = spawn('git', ['show', `${ref}:${file}`], {
      cwd: ctx.worktreeRoot || ctx.repoRoot,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`git show failed with code ${code}: ${stderr.trim()}`));
      }

      resolve({
        content: stdout,
        file,
        ref,
      });
    });
  });
}

export const gitStatusSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.status',
  source: 'builtin',
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

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: ctx.worktreeRoot || ctx.repoRoot,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`git status failed with code ${code}: ${stderr.trim()}`));
      }

      resolve({
        status: stdout,
      });
    });
  });
}
