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
export async function repairToUnifiedDiff(args: { badContent: string }): Promise<LLMMessage> {
  const { badContent } = args;

  const extractCanonicalDiff = (input: string): string => {
    if (!input) return '';

    const fromText = (value: string): string => {
      const start = value.search(/^\s*diff --git /m);
      if (start === -1) return '';
      const section = value.slice(start).trim();
      const fenceClose = section.search(/\n```/);
      if (fenceClose !== -1) return section.slice(0, fenceClose).trim();
      return section;
    };

    const fencedBlocks: string[] = [];
    const fenceRegex = /```(?:diff)?\s*\n([\s\S]*?)\n```/gi;
    let match: RegExpExecArray | null = null;
    while ((match = fenceRegex.exec(input)) !== null) {
      const block = match[1];
      const extracted = fromText(block);
      if (extracted) fencedBlocks.push(extracted);
    }

    if (fencedBlocks.length > 0) return fencedBlocks[fencedBlocks.length - 1];
    return fromText(input);
  };

  return {
    role: 'assistant',
    content: extractCanonicalDiff(badContent || ''),
  };
}
