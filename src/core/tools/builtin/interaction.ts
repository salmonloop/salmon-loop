import { z } from 'zod';

import { text } from '../../../locales/index.js';
import type { AskUserInput, AskUserOutput, LoopInputRequired } from '../../types/index.js';
import { Phase } from '../../types/index.js';
import type { ToolSpec, ToolRuntimeCtx } from '../types.js';

const optionSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

const questionSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  options: z.array(optionSchema).min(2).max(4),
  multiSelect: z.boolean(),
});

const askUserInputSchema = z
  .object({
    questions: z.array(questionSchema).min(1).max(4),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const q of value.questions) {
      if (seen.has(q.question)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate question: ${q.question}`,
        });
        return;
      }
      seen.add(q.question);
    }
  });

const askUserOutputSchema = z.object({
  questions: z.array(questionSchema),
  answers: z.record(z.string()),
});

function buildPrompt(questions: AskUserInput['questions']): string {
  if (questions.length === 0) return text.tools.askUserPromptDefault;
  const first = questions[0];
  const header = first.header?.trim();
  const question = first.question?.trim();
  if (header && question) return `${header}: ${question}`;
  if (header) return header;
  if (question) return question;
  return text.tools.askUserPromptDefault;
}

function buildInputRequired(input: AskUserInput): LoopInputRequired {
  return {
    type: 'question',
    reason: 'clarification',
    prompt: buildPrompt(input.questions),
    questions: input.questions,
  };
}

export const askUserSpec: ToolSpec<AskUserInput, AskUserOutput> = {
  name: 'interaction.ask_user',
  source: 'builtin',
  intent: 'AGENT',
  description: text.tools.askUserDescription,
  riskLevel: 'low',
  sideEffects: ['none'],
  concurrency: 'serial_only',
  allowedPhases: [
    Phase.EXPLORE,
    Phase.PLAN,
    Phase.PATCH,
    Phase.VALIDATE,
    Phase.AST_VALIDATE,
    Phase.VERIFY,
    Phase.SHRINK,
  ],
  inputSchema: askUserInputSchema,
  outputSchema: askUserOutputSchema,
  executor: async (input, ctx: ToolRuntimeCtx) => {
    if (ctx.agentKind === 'subagent') {
      const err = new Error(text.tools.askUserSubagentBlocked);
      (err as any).code = 'ASK_USER_SUBAGENT_BLOCKED';
      throw err;
    }

    if (!ctx.userInputProvider) {
      const err = new Error(text.tools.askUserRequired);
      (err as any).code = 'ASK_USER_REQUIRED';
      (err as any).inputRequired = buildInputRequired(input);
      throw err;
    }

    return ctx.userInputProvider.askUser(input, { signal: ctx.signal });
  },
};
