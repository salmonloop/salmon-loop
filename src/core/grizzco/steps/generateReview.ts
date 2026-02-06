import { text } from '../../../locales/index.js';
import type { LLM } from '../../types.js';
import type { ContextCtx, ReviewCtx } from '../types.js';

function buildReviewPrompt(context: unknown): string {
  const summary = JSON.stringify(context, null, 2);
  return `Please review the following context and provide suggestions for improvement:\n\n${summary}`;
}

function parseReviewResponse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export async function generateReview(ctx: ContextCtx): Promise<ReviewCtx> {
  const reviewPrompt = buildReviewPrompt(ctx.context);
  const llmClient: LLM = ctx.options.llm;

  const response = await llmClient.chat([{ role: 'user', content: reviewPrompt }], {
    tools: [],
    signal: ctx.options.signal,
  });

  if (!response?.content) {
    throw new Error(text.llm.reviewEmpty);
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.review.generated,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    review: {
      suggestions: parseReviewResponse(response.content),
      timestamp: Date.now(),
    },
  };
}
