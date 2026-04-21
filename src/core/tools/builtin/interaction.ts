import { z } from 'zod';

import { text } from '../../../locales/index.js';
import type { AskUserInput, AskUserOutput, LoopInputRequired } from '../../types/runtime.js';
import { Phase } from '../../types/runtime.js';
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
  answers: z.record(z.string(), z.string()),
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
    responseFormat: 'json',
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
    Phase.AUTOPILOT,
    Phase.PATCH,
    Phase.VALIDATE,
    Phase.AST_VALIDATE,
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
      const inputRequired = buildInputRequired(input);
      (err as any).code = 'INTERRUPT_REQUIRED';
      (err as any).interrupt = {
        type: 'awaiting_input',
        reason: inputRequired.reason ?? 'clarification',
        prompt: inputRequired.prompt,
        data: { inputRequired },
      };
      throw err;
    }

    const output = await ctx.userInputProvider.askUser(input, { signal: ctx.signal });
    const validationError = validateAnswers(input, output.answers);
    if (validationError) {
      const err = new Error(validationError);
      (err as any).code = 'INVALID_OUTPUT';
      throw err;
    }
    return { questions: input.questions, answers: output.answers };
  },
};

function validateAnswers(input: AskUserInput, answers: AskUserOutput['answers']): string | null {
  const questionMap = new Map(
    input.questions.map((q) => [q.question, new Set(q.options.map((o) => o.label))]),
  );

  for (const key of Object.keys(answers)) {
    const allowed = questionMap.get(key);
    if (!allowed) {
      return `Unknown question answer key: ${key}`;
    }
    const raw = answers[key] ?? '';
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return `Empty answer for question: ${key}`;
    }
    for (const answer of parts) {
      if (!allowed.has(answer)) {
        return `Invalid answer "${answer}" for question: ${key}`;
      }
    }
  }

  return null;
}
