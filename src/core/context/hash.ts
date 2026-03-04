import { createHash } from 'node:crypto';

import type { Context, ContextTarget } from '../types/context.js';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableValue(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function hashStable(value: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

const SIGNATURE_VERSION = 'v1';

export function createIntentSignature(input: {
  instruction?: string;
  primaryFile?: string;
  selection?: string;
  diffScope?: string;
}): string {
  return `intent:${SIGNATURE_VERSION}:${hashStable({
    instruction: input.instruction ?? '',
    primaryFile: input.primaryFile ?? '',
    selection: input.selection ?? '',
    diffScope: input.diffScope ?? 'primary',
  })}`;
}

export function createTargetSetSignature(targets: ContextTarget[] | undefined): string {
  const normalized = (targets ?? [])
    .map((t) => ({
      path: t.path,
      reason: t.reason,
      confidence: t.confidence,
      churnWeight: t.churnWeight ? Number(t.churnWeight.toFixed(4)) : 0,
      ranking: t.ranking
        ? {
            semanticScore: Number(t.ranking.semanticScore.toFixed(4)),
            churnScore: Number(t.ranking.churnScore.toFixed(4)),
            primaryBoostScore: Number(t.ranking.primaryBoostScore.toFixed(4)),
            finalScore: Number(t.ranking.finalScore.toFixed(6)),
          }
        : undefined,
    }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.reason.localeCompare(b.reason) ||
        a.confidence.localeCompare(b.confidence),
    );
  return `targets:${SIGNATURE_VERSION}:${hashStable(normalized)}`;
}

export function createContextHash(context: Context): string {
  return `context:${SIGNATURE_VERSION}:${hashStable(context)}`;
}
