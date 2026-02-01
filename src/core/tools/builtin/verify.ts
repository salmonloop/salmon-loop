import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { Phase } from '../../types.js';
import { runVerify, classifyError } from '../../verify.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const verifyRunSpec: Omit<ToolSpec, 'executor'> = {
  name: 'test.run',
  source: 'builtin',
  description: text.tools.testRunDescription,
  riskLevel: 'medium',
  sideEffects: ['process'],
  inputSchema: z.object({
    command: z.string().describe('The shell command to run for verification'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    output: z.string(),
    exitCode: z.number().nullable(),
    errorType: z.string().optional(),
    isRetryable: z.boolean().optional(),
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
  const activePath = ctx.worktreeRoot || ctx.repoRoot;
  const result = await runVerify(activePath, command);

  const errorType = !result.ok ? classifyError(result.output) : undefined;

  return {
    ...result,
    errorType,
    isRetryable: !result.ok ? true : false, // In SalmonLoop, most verification failures are retryable by the LLM
  };
}
