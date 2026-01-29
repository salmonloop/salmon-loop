import { text } from '../locales/index.js';

import { LIMITS } from './limits.js';
import type { Context, Plan } from './types.js';

export function formatContextForPrompt(context: Context): string {
  let result = `${text.context.workingDirectory}\n\n`;

  if (context.primaryText) {
    result += `${text.context.primaryFile(context.primaryFile || 'Selection')}\n`;

    let textToDisplay = context.primaryText;
    if (context.symbols && context.symbols.length > 0) {
      const lines = textToDisplay.split('\n');
      const sortedSymbols = [...context.symbols].sort((a, b) => {
        if (a.location.start.line !== b.location.start.line) {
          return b.location.start.line - a.location.start.line;
        }
        return b.location.start.column - a.location.start.column;
      });

      for (const symbol of sortedSymbols) {
        const lineIdx = symbol.location.start.line - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
          const marker = symbol.kind === 'definition' ? '' : text.symbols.info;
          if (marker && !lines[lineIdx].endsWith(marker)) {
            lines[lineIdx] += marker;
          }
        }
      }
      textToDisplay = lines.join('\n');
    }

    result += `${text.context.primaryText}\n${textToDisplay}\n\n`;
  }

  if (context.rgSnippets && context.rgSnippets.length > 0) {
    result += `${text.context.codeSnippets}\n`;
    for (const snippet of context.rgSnippets) {
      result += `${text.context.snippetLocation(snippet.file, snippet.line)}\n${snippet.content}\n---\n`;
    }
  }

  if (context.stagedDiff) {
    result += `${text.context.stagedDiff}\n${context.stagedDiff}\n\n`;
  }

  if (context.unstagedDiff) {
    result += `${text.context.unstagedDiff}\n${context.unstagedDiff}\n\n`;
  }

  if (context.untrackedFiles && context.untrackedFiles.length > 0) {
    result += `${text.context.untrackedFiles}\n${context.untrackedFiles.join('\n')}\n\n`;
  }

  // Fallback for legacy support or if only gitDiff is provided
  if (context.gitDiff && !context.stagedDiff && !context.unstagedDiff) {
    result += `${text.context.gitDiff}\n${context.gitDiff}\n\n`;
  }

  return result;
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
    throw new Error(text.llm.patchEmpty());
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
