import { z } from 'zod';

import { readdir, readFile, writeFile, mkdir } from '../../adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../config/paths.js';
import { getLogger, tryGetLogger } from '../../observability/logger.js';
import { Phase } from '../../types/runtime.js';
import { safeJoin } from '../../utils/path.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

let lastEventTimestampMs = 0;
let eventSequence = 0;

// ── Knowledge quality gates ──────────────────────────────────────────────────

const MIN_RULE_LENGTH = 10;
const MAX_RULE_LENGTH = 500;

function isValidContent(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length >= MIN_RULE_LENGTH && trimmed.length <= MAX_RULE_LENGTH && /[\w]/.test(trimmed)
  );
}

/** Simple Levenshtein distance for short strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

/** Check if a rule is too similar to any existing rule. */
function isDuplicateRule(newRule: string, existingRules: string[]): boolean {
  const normalized = newRule.trim().toLowerCase();
  for (const existing of existingRules) {
    const existingNorm = existing.trim().toLowerCase();
    if (normalized === existingNorm) return true;
    if (levenshtein(normalized, existingNorm) < 5) return true;
  }
  return false;
}

/** Load existing knowledge to check for duplicates. */
async function loadExistingKnowledge(
  knowledgeDir: string,
): Promise<{ rules: string[]; decisions: string[]; deprecatedRules: string[] }> {
  const rules: string[] = [];
  const decisions: string[] = [];
  const deprecatedRules: string[] = [];

  try {
    const files = await readdir(knowledgeDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

    for (const file of jsonFiles) {
      try {
        const content = await readFile(safeJoin(knowledgeDir, file), 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data.project_rules)) rules.push(...data.project_rules);
        if (Array.isArray(data.deprecated_rules)) deprecatedRules.push(...data.deprecated_rules);
        if (Array.isArray(data.architectural_decisions)) {
          for (const d of data.architectural_decisions) {
            if (typeof d.decision === 'string') decisions.push(d.decision);
          }
        }
      } catch (error) {
        /* skip corrupted */
        getLogger().debug(
          `[Knowledge] Failed to read knowledge file ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    /* dir missing */
    getLogger().debug(
      `[Knowledge] Failed to read knowledge directory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { rules, decisions, deprecatedRules };
}

function nextEventFilePrefix(): string {
  const nowMs = Date.now();
  if (nowMs === lastEventTimestampMs) {
    eventSequence += 1;
  } else {
    lastEventTimestampMs = nowMs;
    eventSequence = 0;
  }

  // Keep lexical sort order aligned with chronological order.
  // KnowledgeGatherer sorts filenames as strings (ascending).
  return `${nowMs}-${String(eventSequence).padStart(6, '0')}`;
}

const updateKnowledgeInputSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('project_rules'),
    rules: z.array(z.string()).describe('Full list of active project rules and coding standards'),
    deprecated_rules: z
      .array(z.string())
      .optional()
      .describe('List of previously recorded rules that are no longer valid or have been replaced'),
  }),
  z.object({
    category: z.literal('architectural_decisions'),
    decision: z.string().describe('The new architectural decision to record'),
    related_files: z.array(z.string()).optional().describe('Files affected by this decision'),
  }),
  z.object({
    category: z.literal('user_preferences'),
    preferences: z.string().describe('Updated description of user personal preferences'),
  }),
  z.object({
    category: z.literal('lessons_learned'),
    lessons: z.array(z.string()).describe('Lessons learned from execution outcomes'),
    source: z
      .enum(['success', 'failure'])
      .optional()
      .describe('Whether lessons came from success or failure'),
  }),
]);

export const updateKnowledgeSpec: Omit<ToolSpec, 'executor'> = {
  name: 'update_knowledge',
  source: 'builtin',
  intent: 'WRITE',
  description: 'Persist project-specific knowledge, rules, and decisions for cross-session memory.',
  riskLevel: 'low',
  sideEffects: ['fs_write'],
  concurrency: 'parallel_ok',
  inputSchema: updateKnowledgeInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  allowedPhases: [Phase.EXPLORE, Phase.PLAN, Phase.PATCH],
};

export async function executeUpdateKnowledge(
  input: z.infer<typeof updateKnowledgeInputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { repoRoot } = ctx;
  const indexPath = getDefaultIndexPath(repoRoot);
  const knowledgeDir = safeJoin(indexPath, 'knowledge');

  await mkdir(knowledgeDir, { recursive: true });
  const existing = await loadExistingKnowledge(knowledgeDir);

  // ── Quality gates ────────────────────────────────────────────────────────

  if (input.category === 'project_rules') {
    // Filter out rules that are invalid or duplicate
    const validRules: string[] = [];
    let skipped = 0;
    for (const rule of input.rules) {
      if (!isValidContent(rule)) {
        skipped++;
        continue;
      }
      if (isDuplicateRule(rule, existing.rules)) {
        skipped++;
        continue;
      }
      if (isDuplicateRule(rule, existing.deprecatedRules)) {
        skipped++;
        continue;
      }
      validRules.push(rule);
    }
    if (skipped > 0) {
      tryGetLogger()?.debug(`[Knowledge] Filtered ${skipped} invalid/duplicate rules`);
    }
    // If all rules were filtered, skip the write entirely
    if (
      validRules.length === 0 &&
      (!input.deprecated_rules || input.deprecated_rules.length === 0)
    ) {
      return { success: true, message: 'All rules were duplicates or invalid, nothing to record' };
    }
    // Rewrite input with filtered rules
    (input as any).rules = validRules;
  }

  if (input.category === 'architectural_decisions') {
    if (!isValidContent(input.decision)) {
      return { success: true, message: 'Decision too short or invalid, nothing to record' };
    }
    if (isDuplicateRule(input.decision, existing.decisions)) {
      return { success: true, message: 'Decision already recorded, skipping duplicate' };
    }
  }

  if (input.category === 'user_preferences') {
    if (!isValidContent(input.preferences)) {
      return { success: true, message: 'Preferences too short or invalid, nothing to record' };
    }
  }

  if (input.category === 'lessons_learned') {
    const validLessons = input.lessons.filter((l) => isValidContent(l));
    if (validLessons.length === 0) {
      return { success: true, message: 'All lessons were invalid, nothing to record' };
    }
    (input as any).lessons = validLessons;
  }

  // ── Write ────────────────────────────────────────────────────────────────

  const fileName = `${nextEventFilePrefix()}-${input.category}.json`;
  const filePath = safeJoin(knowledgeDir, fileName);

  let dataToSave: Record<string, unknown> = {};
  switch (input.category) {
    case 'project_rules':
      dataToSave = {
        project_rules: (input as any).rules,
        deprecated_rules: input.deprecated_rules,
      };
      break;
    case 'architectural_decisions':
      dataToSave = {
        architectural_decisions: [
          {
            date: new Date().toISOString().split('T')[0],
            decision: input.decision,
            related_files: input.related_files,
          },
        ],
      };
      break;
    case 'user_preferences':
      dataToSave = { user_preferences: input.preferences };
      break;
    case 'lessons_learned':
      dataToSave = {
        lessons_learned: (input as any).lessons,
        source: (input as any).source ?? 'unknown',
        date: new Date().toISOString().split('T')[0],
      };
      break;
  }

  try {
    await writeFile(filePath, JSON.stringify(dataToSave, null, 2));
    return {
      success: true,
      message: `Successfully recorded knowledge event: ${fileName}`,
    };
  } catch (e) {
    throw new Error(
      `Failed to record knowledge event: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
