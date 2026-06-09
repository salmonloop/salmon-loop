import { text } from '../../locales/index.js';
import { LIMITS } from '../config/limits.js';
import { ContextFormatConverter } from '../context/formatters/json-converter.js';
import { formatContextForXmlPrompt } from '../context/formatters/xml-context.js';
import type { Context } from '../types/context.js';
import type { Plan } from '../types/planning.js';

import { wrapPatchEmpty } from './errors.js';

export interface FormatOptions {
  format?: 'xml' | 'json';
}

export function formatContextForPrompt(context: Context, options: FormatOptions = {}): string {
  const format = options.format ?? 'json';

  if (format === 'json') {
    return JSON.stringify(ContextFormatConverter.contextToJson(context));
  }

  return formatContextForXmlPrompt(context);
}

export function parsePlanFromLLMContent(content: string): Plan {
  const trimmed = String(content ?? '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    const preview = trimmed.slice(0, 80);
    throw new Error(
      `${text.llm.planInvalidJson} — Content must start with { and end with }. Got: ${preview}${trimmed.length > 80 ? '…' : ''}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (jsonError) {
    const errorMsg = jsonError instanceof Error ? jsonError.message : String(jsonError);
    throw new Error(`${text.llm.planInvalidJson} — JSON parse error: ${errorMsg}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${text.llm.planInvalidJson} — Expected object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
  }

  const plan = parsed as Plan;
  const missingKeys: string[] = [];
  if (!plan.goal) missingKeys.push('goal');
  if (!Array.isArray(plan.files)) missingKeys.push('files (must be array)');
  if (!Array.isArray(plan.changes)) missingKeys.push('changes (must be array)');
  if (!plan.verify) missingKeys.push('verify');
  if (missingKeys.length > 0) {
    throw new Error(`${text.llm.planInvalid} — Missing or invalid keys: ${missingKeys.join(', ')}`);
  }
  return plan;
}

export function extractUnifiedDiffFromLLMContent(content: string): string {
  if (!content) {
    throw wrapPatchEmpty();
  }

  const looksLikeUnifiedDiff = (text: string): boolean => {
    return /^\s*diff --git /m.test(text);
  };

  // 1) Prefer fenced code blocks and always pick the LAST canonical diff block (LLM may generate multiple attempts).
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

  // 2) Raw diff without markdown: keep the first canonical diff section.
  // In "pure diff" mode, LLMs typically return only the patch, so selecting the first marker
  // avoids accidentally dropping the leading `diff --git` header.
  const rawStart = content.search(/^\s*diff --git /m);
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
