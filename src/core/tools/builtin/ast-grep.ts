import * as child_process from 'child_process';
import { promisify } from 'util';

import { z } from 'zod';

import { Phase } from '../../types.js';
import { processResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

const execAsync = promisify(child_process.exec);

/**
 * Spec for the ast-grep structural search tool.
 */
export const astGrepSpec: Omit<ToolSpec, 'executor'> = {
  name: 'code.search_ast',
  source: 'builtin',
  description:
    'Structural search using ast-grep (sg). Use $VAR for placeholders (e.g., "console.log($ARGS)").',
  riskLevel: 'low',
  sideEffects: ['process'],
  concurrency: 'mutex_by_resource',
  computeResources: (_input, ctx) => [processResource(ctx)],
  inputSchema: z.object({
    pattern: z.string().describe('ast-grep pattern to search for'),
    paths: z.array(z.string()).optional().describe('Scope search to specific files or directories'),
    language: z
      .enum(['typescript', 'tsx', 'javascript', 'jsx', 'python', 'go', 'rust'])
      .optional()
      .describe('Source language'),
  }),
  outputSchema: z.object({
    matches: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        content: z.string(),
        replacement: z.string().optional(),
      }),
    ),
    error: z.string().optional(),
  }),
  allowedPhases: [Phase.CONTEXT, Phase.PLAN],
};

/**
 * Executes the ast-grep search.
 */
export async function executeAstGrep(
  input: z.infer<typeof astGrepSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  try {
    const args = ['run', '--pattern', `'${input.pattern}'`, '--json'];

    if (input.language) {
      args.push('--lang', input.language);
    }

    const targetPaths = input.paths?.length ? input.paths.join(' ') : '.';
    const command = `sg ${args.join(' ')} ${targetPaths}`;

    const { stdout, stderr } = await execAsync(command, {
      cwd: ctx.worktreeRoot || ctx.repoRoot,
      maxBuffer: 1024 * 1024 * 5, // 5MB buffer for large search results
    });

    if (stderr && !stdout) {
      return { matches: [], error: stderr };
    }

    const rawMatches = JSON.parse(stdout || '[]');

    // Transform sg JSON output to our standardized format
    const matches = rawMatches.map((m: any) => ({
      file: m.file,
      line: m.range.start.line + 1, // sg is 0-indexed
      content: m.lines,
      replacement: m.replacement,
    }));

    return { matches };
  } catch (e: any) {
    // ast-grep returns exit code 1 if no matches are found, which promisify(exec) treats as an error
    if (e.stdout) {
      try {
        const rawMatches = JSON.parse(e.stdout);
        const matches = rawMatches.map((m: any) => ({
          file: m.file,
          line: m.range.start.line + 1,
          content: m.lines,
        }));
        return { matches };
      } catch {
        // Fall through to generic error
      }
    }

    return {
      matches: [],
      error: e.message.includes('not found')
        ? 'ast-grep (sg) is not installed in the environment'
        : e.message,
    };
  }
}
