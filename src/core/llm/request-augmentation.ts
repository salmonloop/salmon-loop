import type { RelevantMemoryCandidate } from '../memory/relevant-retrieval.js';

const MEMORY_HEADER = '[Relevant memory]';

export interface AugmentPromptWithRelevantMemoryArgs {
  basePrompt: string;
  selectedEntries?: RelevantMemoryCandidate[];
  budgetTokens?: number;
  countTokens?: (text: string) => number;
}

export interface AugmentPromptWithRelevantMemoryResult {
  prompt: string;
  injectedEntries: RelevantMemoryCandidate[];
  memoryBlock?: string;
}

function defaultCountTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalizeEntry(entry: RelevantMemoryCandidate): RelevantMemoryCandidate {
  return {
    path: String(entry.path),
    title: String(entry.title),
    summary: String(entry.summary),
    tags: entry.tags,
  };
}

function formatRelevantMemoryEntry(entry: RelevantMemoryCandidate): string {
  return `- ${entry.path} | ${entry.title}\n  ${entry.summary}`;
}

export function augmentPromptWithRelevantMemory(
  args: AugmentPromptWithRelevantMemoryArgs,
): AugmentPromptWithRelevantMemoryResult {
  const basePrompt = String(args.basePrompt ?? '').trimEnd();
  const selectedEntries = Array.isArray(args.selectedEntries)
    ? args.selectedEntries.map(normalizeEntry)
    : [];
  if (selectedEntries.length === 0) {
    return { prompt: basePrompt, injectedEntries: [] };
  }

  const countTokens = args.countTokens ?? defaultCountTokens;
  const budgetTokens =
    typeof args.budgetTokens === 'number'
      ? Math.max(0, Math.floor(args.budgetTokens))
      : Number.MAX_SAFE_INTEGER;

  const headerTokens = Math.max(0, Math.floor(countTokens(MEMORY_HEADER)));
  if (headerTokens > budgetTokens) {
    return { prompt: basePrompt, injectedEntries: [] };
  }

  let remainingBudget = budgetTokens - headerTokens;
  const injectedEntries: RelevantMemoryCandidate[] = [];
  const renderedEntries: string[] = [];

  for (const entry of selectedEntries) {
    const rendered = formatRelevantMemoryEntry(entry);
    const entryTokens = Math.max(0, Math.floor(countTokens(rendered)));
    if (entryTokens > remainingBudget) {
      break;
    }
    injectedEntries.push(entry);
    renderedEntries.push(rendered);
    remainingBudget -= entryTokens;
  }

  if (renderedEntries.length === 0) {
    return { prompt: basePrompt, injectedEntries: [] };
  }

  const memoryBlock = [MEMORY_HEADER, ...renderedEntries].join('\n');
  return {
    prompt: basePrompt ? `${basePrompt}\n\n${memoryBlock}` : memoryBlock,
    injectedEntries,
    memoryBlock,
  };
}
