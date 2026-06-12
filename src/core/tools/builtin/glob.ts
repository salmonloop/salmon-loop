import { join } from 'path';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { spawnCommand } from '../../runtime/process-runner.js';
import { Phase } from '../../types/runtime.js';
import { normalizePath } from '../../utils/path.js';
import { pathPrefixResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

const RG_TIMEOUT_MS = 10_000;

export const globFindSpec: Omit<ToolSpec, 'executor'> = {
  name: 'glob.find',
  source: 'builtin',
  intent: 'SEARCH',
  description: text.tools.globFindDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [pathPrefixResource(ctx, '.')],
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "src/**/*.test.*")'),
    directory: z.string().optional().describe('Directory to search in (relative, default: ".")'),
    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(200)
      .describe('Maximum number of files to return'),
    respectGitignore: z.boolean().default(true).describe('Respect .gitignore (default: true)'),
    includeHidden: z.boolean().default(false).describe('Include hidden files (starting with ".")'),
  }),
  outputSchema: z.object({
    files: z.array(z.string()),
    truncated: z.boolean(),
    totalFound: z.number(),
  }),
  allowedPhases: [
    Phase.SLASH,
    Phase.CONTEXT,
    Phase.EXPLORE,
    Phase.PLAN,
    Phase.AUTOPILOT,
    Phase.VERIFY,
  ],
};

export async function executeGlobFind(
  input: z.infer<typeof globFindSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const cwd = input.directory ? join(repoRoot, input.directory) : repoRoot;

  const args = ['--files'];

  if (!input.respectGitignore) args.push('--no-ignore');
  if (input.includeHidden) args.push('--hidden');

  args.push('--glob', input.pattern);
  args.push(cwd);

  let stdout = '';
  const result = await spawnCommand({
    command: 'rg',
    args,
    cwd: repoRoot,
    env: ctx.env ?? process.env,
    timeoutMs: RG_TIMEOUT_MS,
    onStdoutChunk: (chunk) => {
      stdout += Buffer.from(chunk).toString();
    },
    onStderrChunk: () => {},
  });

  if (result.error || result.timedOut || (result.code !== 0 && result.code !== 1)) {
    return { files: [], truncated: false, totalFound: 0 };
  }

  const allFiles = stdout
    .split('\n')
    .map((line) => normalizePath(line.trim()).replace(/^(\.\/|\/)+/, ''))
    .filter(Boolean);

  const totalFound = allFiles.length;
  const truncated = totalFound > input.maxMatches;
  const files = allFiles.slice(0, input.maxMatches);

  return { files, truncated, totalFound };
}
