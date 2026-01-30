import { text } from '../locales/index.js';

import { formatContextForXmlPrompt } from './context/formatters/xml-context.js';
import { LIMITS } from './limits.js';
import { wrapPatchEmpty } from './llm/errors.js';
import type { Context, Plan } from './types.js';

export function formatContextForPrompt(context: Context): string {
  return formatContextForXmlPrompt(context);
}

export function extractJson(content: string): any {
  // 1. Try to find JSON block
  const jsonBlockMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1]);
    } catch (__e) {
      // Fallback to raw content if block is invalid
    }
  }

  // 2. Try to find anything that looks like a JSON object
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (__e) {
      // Fallback
    }
  }

  // 3. Final fallback: try parsing the whole content
  return JSON.parse(content);
}

export function parsePlanFromLLMContent(content: string): Plan {
  const plan = extractJson(content) as Plan;
  if (!plan.goal || !Array.isArray(plan.files) || !Array.isArray(plan.changes) || !plan.verify) {
    throw new Error(text.llm.planInvalid);
  }
  return plan;
}

export function extractUnifiedDiffFromLLMContent(content: string): string {
  if (!content) {
    throw wrapPatchEmpty();
  }

  // Extract ONLY the last diff block (LLM may generate multiple attempts)
  const diffBlocks = content.match(/```(?:diff)?\s*\n(diff --git[\s\S]*?)\n```/g);
  if (diffBlocks && diffBlocks.length > 0) {
    const lastBlock = diffBlocks[diffBlocks.length - 1];
    return lastBlock
      .replace(/```(?:diff)?\s*\n/, '')
      .replace(/\n```\s*$/, '')
      .trim();
  }

  // Fallback: extract raw diff without markdown
  const rawDiffMatch = content.match(/(diff --git[\s\S]*?)(?:\n\n[A-Z]|$)/);
  if (rawDiffMatch) {
    return rawDiffMatch[1].trim();
  }

  // Final fallback: original simple cleanup
  let cleanContent = content;
  cleanContent = cleanContent.replace(/^```(?:diff)?\s*\n/, '');
  cleanContent = cleanContent.replace(/\n```\s*$/, '');

  const trimmed = cleanContent.trim();
  if (trimmed.length > LIMITS.maxDiffLines * 200) {
    // This is a heuristic guardrail to prevent accidentally treating a large non-diff blob as a patch.
    // The caller can still decide how to handle this.
  }
  return trimmed;
}
