import { z } from 'zod';

import { spawnCommand } from '../../runtime/process-runner.js';
import { Phase } from '../../types/runtime.js';
import { processResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

const LANGUAGE_DESCRIPTION =
  'Source language plugin id (e.g., "typescript", "tsx", "javascript"). If omitted, ast-grep will auto-detect.';

/**
 * Spec for the ast-grep structural search tool.
 */
export const astGrepSpec: Omit<ToolSpec, 'executor'> = {
  name: 'code.search_ast',
  source: 'builtin',
  intent: 'SEARCH',
  description:
    'Structural search using ast-grep (sg). Use $VAR for placeholders (e.g., "console.log($ARGS)").',
  riskLevel: 'low',
  sideEffects: ['process'],
  concurrency: 'mutex_by_resource',
  computeResources: (_input, ctx) => [processResource(ctx)],
  inputSchema: z.object({
    pattern: z.string().describe('ast-grep pattern to search for'),
    paths: z.array(z.string()).optional().describe('Scope search to specific files or directories'),
    language: z.string().optional().describe(LANGUAGE_DESCRIPTION),
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
  allowedPhases: [Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.AUTOPILOT],
};

/**
 * Executes the ast-grep search.
 */
export async function executeAstGrep(
  input: z.infer<typeof astGrepSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  try {
    const args = ['run', '--pattern', input.pattern, '--json'];

    if (input.language) {
      args.push('--lang', input.language);
    }

    const targetPaths = input.paths?.length ? input.paths : ['.'];
    const allArgs = [...args, ...targetPaths];
    const maxOutputBytes = 1024 * 1024 * 5;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    const result = await spawnCommand({
      command: 'sg',
      args: allArgs,
      cwd: ctx.worktreeRoot || ctx.repoRoot,
      env: ctx.env ? { ...process.env, ...ctx.env } : process.env,
      timeoutMs: 30_000,
      signal: ctx.signal,
      onStdoutChunk: (chunk) => {
        if (stdoutBytes >= maxOutputBytes) return;
        const buffer = Buffer.from(chunk);
        const remaining = maxOutputBytes - stdoutBytes;
        if (buffer.length <= remaining) {
          stdout += buffer.toString();
          stdoutBytes += buffer.length;
          return;
        }
        stdout += buffer.subarray(0, remaining).toString();
        stdoutBytes += remaining;
      },
      onStderrChunk: (chunk) => {
        stderr += Buffer.from(chunk).toString();
      },
    });

    if (result.error) {
      return {
        matches: [],
        error: result.error.message.includes('not found')
          ? 'ast-grep (sg) is not installed in the environment'
          : result.error.message,
      };
    }

    if (result.timedOut) {
      return {
        matches: [],
        error: 'ast-grep execution timed out',
      };
    }

    if (stderr && !stdout && result.code !== 1) {
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
  } catch (e: unknown) {
    return {
      matches: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
