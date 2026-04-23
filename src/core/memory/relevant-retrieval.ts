import { extractKeywords } from '../context/keywords.js';
import type { Context } from '../types/context.js';

const DEFAULT_MAX_ITEMS = 3;
const DEFAULT_MAX_SUMMARY_CHARS = 220;

export interface RelevantMemoryCandidate {
  path: string;
  title: string;
  summary: string;
  tags?: string[];
}

export interface SelectRelevantMemoryArgs {
  instruction?: string;
  candidates: RelevantMemoryCandidate[];
  alreadySurfacedText?: string[];
  activeToolNames?: string[];
  maxItems?: number;
  maxSummaryChars?: number;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeCandidate(
  candidate: RelevantMemoryCandidate,
  maxSummaryChars: number,
): RelevantMemoryCandidate | undefined {
  const path = trimToUndefined(candidate.path);
  const title = trimToUndefined(candidate.title);
  const summary = trimToUndefined(candidate.summary);
  if (!path || !title || !summary) return undefined;

  const tags = Array.isArray(candidate.tags)
    ? candidate.tags
        .map((tag) => trimToUndefined(tag)?.toLowerCase())
        .filter((tag): tag is string => Boolean(tag))
    : undefined;

  return {
    path,
    title,
    summary: clampText(summary, maxSummaryChars),
    tags,
  };
}

function buildAlreadySurfacedHaystack(values: string[] | undefined): string {
  return (values ?? []).join('\n').toLowerCase();
}

function hasToolConflict(candidate: RelevantMemoryCandidate, activeToolNames: string[]): boolean {
  const toolTags = (candidate.tags ?? []).filter((tag) => tag.startsWith('tool:'));
  if (toolTags.length === 0) return false;
  const active = new Set(activeToolNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (active.size === 0) return false;
  return toolTags.some((tag) => active.has(tag.slice('tool:'.length)));
}

function computeCandidateScore(candidate: RelevantMemoryCandidate, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const pathLower = candidate.path.toLowerCase();
  const titleLower = candidate.title.toLowerCase();
  const summaryLower = candidate.summary.toLowerCase();
  const tagsLower = candidate.tags ?? [];

  let score = 0;
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) continue;

    if (pathLower.includes(normalized)) score += 6;
    if (titleLower.includes(normalized)) score += 5;
    if (summaryLower.includes(normalized)) score += 4;
    if (tagsLower.some((tag) => tag.includes(normalized))) score += 3;
  }

  return score;
}

export function buildRelevantMemoryCandidates(context: Context): RelevantMemoryCandidate[] {
  const candidates: RelevantMemoryCandidate[] = [];
  const knowledge = context.knowledgeBase;
  const metadata = context.projectMetadata;

  if (Array.isArray(knowledge?.project_rules) && knowledge.project_rules.length > 0) {
    candidates.push({
      path: '.salmonloop/knowledge/project_rules',
      title: 'Project rules',
      summary: knowledge.project_rules.join('; '),
      tags: ['rules', 'project'],
    });
  }

  if (trimToUndefined(knowledge?.user_preferences)) {
    candidates.push({
      path: '.salmonloop/knowledge/user_preferences',
      title: 'User preferences',
      summary: knowledge!.user_preferences!,
      tags: ['preferences', 'user'],
    });
  }

  for (const [index, decision] of (knowledge?.architectural_decisions ?? []).entries()) {
    const summary = trimToUndefined(decision?.decision);
    if (!summary) continue;
    candidates.push({
      path: `.salmonloop/knowledge/architectural_decisions/${index + 1}`,
      title: `Architectural decision ${index + 1}`,
      summary,
      tags: ['architecture', ...(decision.related_files ?? []).map((file) => file.toLowerCase())],
    });
  }

  if (trimToUndefined(metadata?.aiInstructions)) {
    candidates.push({
      path: '.salmonloop/project/ai-instructions',
      title: 'Project AI instructions',
      summary: metadata!.aiInstructions!,
      tags: ['instructions', 'project'],
    });
  }

  return candidates;
}

export function selectRelevantMemory(args: SelectRelevantMemoryArgs): RelevantMemoryCandidate[] {
  const maxItems = Math.max(1, Math.floor(args.maxItems ?? DEFAULT_MAX_ITEMS));
  const maxSummaryChars = Math.max(
    48,
    Math.floor(args.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS),
  );
  const haystack = buildAlreadySurfacedHaystack(args.alreadySurfacedText);
  const activeToolNames = args.activeToolNames ?? [];
  const keywords = extractKeywords(args.instruction ?? '');

  const deduped = new Map<string, RelevantMemoryCandidate>();
  for (const rawCandidate of args.candidates) {
    const candidate = normalizeCandidate(rawCandidate, maxSummaryChars);
    if (!candidate) continue;
    if (deduped.has(candidate.path)) continue;
    if (
      haystack.includes(candidate.path.toLowerCase()) ||
      haystack.includes(candidate.title.toLowerCase()) ||
      haystack.includes(candidate.summary.toLowerCase())
    ) {
      continue;
    }
    if (hasToolConflict(candidate, activeToolNames)) continue;
    deduped.set(candidate.path, candidate);
  }

  const scored = [...deduped.values()].map((candidate) => ({
    candidate,
    score: computeCandidateScore(candidate, keywords),
  }));

  const ranked = scored
    .filter((entry) => entry.score > 0 || keywords.length === 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.candidate.path.localeCompare(right.candidate.path);
    });

  return ranked.slice(0, maxItems).map((entry) => entry.candidate);
}
