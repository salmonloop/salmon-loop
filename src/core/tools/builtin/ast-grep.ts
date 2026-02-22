import { z } from 'zod';

import { pluginRegistry } from '../../plugin/registry.js';
import { spawnCommand } from '../../runtime/process-runner.js';
import { Phase } from '../../types/index.js';
import { processResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

/**
 * Get description for language parameter based on registered plugins.
 */
function getLanguageDescription(): string {
  const plugins = pluginRegistry.getAll();
  const langIds = plugins.map((p) => p.meta.id);
  const examples = langIds.slice(0, 5).join(', ');
  return `Source language. Supported: ${examples}${langIds.length > 5 ? ' (and more)' : ''}`;
}

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
    language: z.string().optional().describe(getLanguageDescription()),
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
  } catch (e: any) {
    return {
      matches: [],
      error: e.message,
    };
  }
}
