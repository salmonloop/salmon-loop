import { z } from 'zod';

import { Phase, ExecutionPhase } from '../../../types.js';
import { repoResource } from '../../parallel/resource-helpers.js';
import { ToolSpec } from '../../types.js';

export const CodeSearchInput = z.object({
  pattern: z.string().min(1).describe('The regular expression pattern to search for'),
  glob: z.string().optional().describe('Optional glob pattern to filter files (e.g. "*.ts")'),
  maxMatches: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum number of matches to return'),
  cwd: z.string().optional().describe('Directory to search in (defaults to repo root)'),
  isRegex: z
    .boolean()
    .default(false)
    .describe('Whether to treat the pattern as a regular expression'),
});

export const CodeSearchMatch = z.object({
  file: z.string().describe('Relative path to the file'),
  line: z.number().int().describe('Line number (1-indexed)'),
  column: z.number().int().optional().describe('Column number (1-indexed)'),
  snippet: z.string().describe('The matching line content'),
});

export const CodeSearchOutput = z.object({
  matches: z.array(CodeSearchMatch).describe('List of matches found'),
  truncated: z
    .boolean()
    .default(false)
    .describe('Whether the results were truncated due to limits'),
  backend: z.string().describe('The implementation backend used (for auditing)'),
  stats: z
    .object({
      files: z.number().int().optional().describe('Number of files searched'),
      hits: z.number().int().optional().describe('Total number of hits found'),
    })
    .partial(),
});

export type CodeSearchInputT = z.infer<typeof CodeSearchInput>;
export type CodeSearchOutputT = z.infer<typeof CodeSearchOutput>;

/**
 * Specification for the code search tool.
 * The executor will be bound during tool registration.
 */
export const CodeSearchSpec: Omit<ToolSpec<CodeSearchInputT, CodeSearchOutputT>, 'executor'> & {
  allowedPhases: ExecutionPhase[];
} = {
  name: 'code.search',
  source: 'builtin',
  intent: 'SEARCH',
  description: 'Fast file pattern matching tool that works with any codebase size',
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  allowedPhases: [Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.PATCH, Phase.VERIFY],
  inputSchema: CodeSearchInput,
  outputSchema: CodeSearchOutput,
};
