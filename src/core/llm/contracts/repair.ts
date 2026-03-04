import { LIMITS } from '../../config/limits.js';
import type { ChatOptions, LLM, LLMMessage } from '../../types/llm.js';

function truncateForPrompt(text: string, maxChars: number): string {
  const value = String(text ?? '');
  if (value.length <= maxChars) return value;

  const head = Math.max(0, Math.floor(maxChars * 0.6));
  const tail = Math.max(0, maxChars - head);
  return `${value.slice(0, head)}\n…[truncated]…\n${value.slice(-tail)}`;
}

export async function repairToJsonObject(args: {
  llm: LLM;
  baseMessages: LLMMessage[];
  chatOptions: ChatOptions;
  badContent: string;
  reason: string;
}): Promise<LLMMessage> {
  const { llm, baseMessages, chatOptions, badContent, reason } = args;

  const prompt = [
    'Your previous response did not satisfy the contract.',
    `Reason: ${reason}`,
    '',
    'Return ONLY a single JSON object.',
    '- No Markdown fences.',
    '- No commentary.',
    '- No leading/trailing text.',
    '',
    'The JSON object MUST include keys: goal, files, changes, verify.',
    '',
    'Previous response (truncated):',
    truncateForPrompt(badContent, Math.min(1200, Math.max(400, LIMITS.maxContextChars / 100))),
  ].join('\n');

  return llm.chat(
    [
      ...baseMessages,
      { role: 'assistant', content: badContent || '' },
      { role: 'user', content: prompt },
    ],
    {
      ...chatOptions,
      responseFormat: 'json_object',
      // Ensure the model cannot get "distracted" by tool calling during repair.
      tools: undefined,
      toolSpecs: undefined,
      toolChoice: undefined,
      temperature: 0,
    },
  );
}
export async function repairToUnifiedDiff(args: {
  llm: LLM;
  baseMessages: LLMMessage[];
  chatOptions: ChatOptions;
  badContent: string;
  reason: string;
}): Promise<LLMMessage> {
  const { llm, baseMessages, chatOptions, badContent, reason } = args;

  const prompt = [
    'Your previous response did not satisfy the contract.',
    `Reason: ${reason}`,
    '',
    'Return ONLY a standard git unified diff patch.',
    '- It MUST start with `diff --git`.',
    '- No Markdown fences.',
    '- No commentary.',
    '- Exactly one final patch block (no multiple alternatives).',
    '',
    'Previous response (truncated):',
    truncateForPrompt(badContent, Math.min(1200, Math.max(400, LIMITS.maxContextChars / 100))),
  ].join('\n');

  return llm.chat(
    [
      ...baseMessages,
      { role: 'assistant', content: badContent || '' },
      { role: 'user', content: prompt },
    ],
    {
      ...chatOptions,
      responseFormat: 'text',
      tools: undefined,
      toolSpecs: undefined,
      toolChoice: undefined,
      temperature: 0,
    },
  );
}
