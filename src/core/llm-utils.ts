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

  const looksLikeUnifiedDiff = (text: string): boolean => {
    return /^\s*(diff --git |--- a\/)/m.test(text);
  };

  // 1) Prefer fenced code blocks and always pick the LAST diff-like block (LLM may generate multiple attempts).
  // Accept both git-style (`diff --git`) and minimal unified diffs (`--- a/...` + `+++ b/...`).
  const fencedBlocks: string[] = [];
  const fenceRegex = /```(?:diff)?\s*\n([\s\S]*?)\n```/gi;
  let fenceMatch: RegExpExecArray | null = null;
  while ((fenceMatch = fenceRegex.exec(content)) !== null) {
    const block = fenceMatch[1];
    if (typeof block === 'string' && looksLikeUnifiedDiff(block)) {
      fencedBlocks.push(block);
    }
  }
  if (fencedBlocks.length > 0) {
    return fencedBlocks[fencedBlocks.length - 1].trim();
  }

  // 2) Raw diff without markdown: keep the first diff-like section.
  // In "pure diff" mode, LLMs typically return only the patch, so selecting the first marker
  // avoids accidentally dropping the leading `diff --git` header.
  const rawStart = content.search(/^\s*(diff --git |--- a\/)/m);
  if (rawStart !== -1) return content.slice(rawStart).trim();

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
