import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { parseRunnerOutput, parseStructuredSummary } from '../../feedback/parsers.js';
import { Phase } from '../../types/runtime.js';
import {
  detectRunner,
  injectJsonFlags,
  type RunnerKind,
} from '../../verification/detect-runner.js';
import {
  runVerify,
  classifyError,
  isRetryable as checkRetryable,
  parseTestSummary,
} from '../../verification/runner.js';
import { processResource, repoResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const verifyRunSpec: Omit<ToolSpec, 'executor'> = {
  name: 'test.run',
  source: 'builtin',
  intent: 'INFRA',
  description: text.tools.testRunDescription,
  riskLevel: 'medium',
  sideEffects: ['process'],
  concurrency: 'isolated',
  computeResources: (_input, ctx) => [repoResource(ctx), processResource(ctx)],
  inputSchema: z.object({
    command: z.string().describe('The shell command to run for verification'),
    runner: z
      .enum(['jest', 'vitest', 'pytest', 'tsc', 'eslint', 'bun', 'go'])
      .optional()
      .describe('Test runner type. Auto-detected from command if omitted.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    output: z.string(),
    exitCode: z.number().nullable(),
    errorType: z.string().optional(),
    isRetryable: z.boolean().optional(),
    diagnostics: z
      .array(
        z.object({
          file: z.string(),
          line: z.number().optional(),
          column: z.number().optional(),
          severity: z.enum(['error', 'warning']),
          message: z.string(),
          source: z.string(),
        }),
      )
      .optional(),
    summary: z
      .object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
        skipped: z.number(),
      })
      .optional(),
  }),
  allowedPhases: [Phase.VERIFY],
};

/**
 * Builtin tool to run verification commands
 */
export async function executeVerifyRun(
  input: z.infer<typeof verifyRunSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { command } = input;
  const runner: RunnerKind = input.runner ?? detectRunner(command);
  const effectiveCommand = injectJsonFlags(command, runner);

  const activePath = ctx.worktreeRoot || ctx.repoRoot;
  const result = await runVerify(activePath, effectiveCommand, ctx.env, ctx.signal);

  const errorType = !result.ok ? classifyError(result.output) : undefined;

  // Structured parsing when we know the runner; generic text heuristics otherwise
  const diagnostics = !result.ok ? parseRunnerOutput(result.output, runner) : [];

  // Prefer structured JSON summary; fall back to regex-based text parser
  const summary = parseStructuredSummary(result.output, runner) ?? parseTestSummary(result.output);

  return {
    ...result,
    errorType,
    isRetryable: errorType ? checkRetryable(errorType) : false,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    summary,
  };
}
