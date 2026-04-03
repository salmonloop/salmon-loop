import { createHash } from 'crypto';

export const TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION = 'v1' as const;
export const TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM = 'sha256' as const;
export const TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION = 1 as const;
const DEFAULT_MAX_ENTRIES = 256;

export type ToolResultReplacementDecision = 'kept' | 'replaced';

export interface ToolResultReplacementEntry {
  toolResultId: string;
  decision: ToolResultReplacementDecision;
  preview: string;
  frozenAt: number;
  sourceArtifactHandle?: string;
  identityVersion: typeof TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION;
  hashAlgorithm: typeof TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM;
}

export interface ToolResultReplacementState {
  schemaVersion: typeof TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION;
  entries: Record<string, ToolResultReplacementEntry>;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return JSON.stringify(normalizeNewlines(value));
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(Number(value));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function createToolResultIdentity(params: {
  canonicalToolCallIdentity: string;
  payload: unknown;
}): string {
  const payloadBytes = canonicalize(params.payload);
  const hash = createHash(TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM);
  hash.update(TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION);
  hash.update('\n');
  hash.update(normalizeNewlines(params.canonicalToolCallIdentity).trim());
  hash.update('\n');
  hash.update(payloadBytes);
  return hash.digest('hex');
}

function isValidEntry(value: unknown): value is ToolResultReplacementEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ToolResultReplacementEntry;
  if (!entry.toolResultId || typeof entry.toolResultId !== 'string') return false;
  if (entry.decision !== 'kept' && entry.decision !== 'replaced') return false;
  if (typeof entry.preview !== 'string') return false;
  if (typeof entry.frozenAt !== 'number' || !Number.isFinite(entry.frozenAt)) return false;
  if (entry.sourceArtifactHandle !== undefined && typeof entry.sourceArtifactHandle !== 'string') {
    return false;
  }
  if (entry.identityVersion !== TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION) return false;
  if (entry.hashAlgorithm !== TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM) return false;
  return true;
}

export function normalizeToolResultReplacementState(
  state: ToolResultReplacementState | undefined,
): ToolResultReplacementState | undefined {
  if (!state || typeof state !== 'object') return undefined;
  if (state.schemaVersion !== TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION) return undefined;
  if (!state.entries || typeof state.entries !== 'object') return undefined;

  const normalizedEntries: Record<string, ToolResultReplacementEntry> = {};
  for (const [key, value] of Object.entries(state.entries)) {
    if (!isValidEntry(value)) continue;
    if (value.toolResultId !== key) continue;
    normalizedEntries[key] = {
      toolResultId: value.toolResultId,
      decision: value.decision,
      preview: value.preview,
      frozenAt: value.frozenAt,
      sourceArtifactHandle: value.sourceArtifactHandle,
      identityVersion: value.identityVersion,
      hashAlgorithm: value.hashAlgorithm,
    };
  }

  if (Object.keys(normalizedEntries).length === 0) return undefined;
  return {
    schemaVersion: TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION,
    entries: normalizedEntries,
  };
}

export function createEmptyToolResultReplacementState(): ToolResultReplacementState {
  return {
    schemaVersion: TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION,
    entries: {},
  };
}

export function freezeToolResultReplacementDecision(
  state: ToolResultReplacementState | undefined,
  entry: Omit<ToolResultReplacementEntry, 'identityVersion' | 'hashAlgorithm' | 'frozenAt'> & {
    frozenAt?: number;
  },
  options?: { maxEntries?: number },
): ToolResultReplacementState {
  const base =
    normalizeToolResultReplacementState(state) ?? createEmptyToolResultReplacementState();
  const existing = base.entries[entry.toolResultId];
  if (existing) {
    return base;
  }

  const nextEntries: Record<string, ToolResultReplacementEntry> = {
    ...base.entries,
    [entry.toolResultId]: {
      toolResultId: entry.toolResultId,
      decision: entry.decision,
      preview: entry.preview,
      frozenAt: entry.frozenAt ?? Date.now(),
      sourceArtifactHandle: entry.sourceArtifactHandle,
      identityVersion: TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION,
      hashAlgorithm: TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM,
    },
  };

  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const keys = Object.keys(nextEntries);
  if (keys.length > maxEntries) {
    const sorted = keys.sort((a, b) => nextEntries[a].frozenAt - nextEntries[b].frozenAt);
    for (const evict of sorted.slice(0, keys.length - maxEntries)) {
      delete nextEntries[evict];
    }
  }

  return {
    schemaVersion: TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION,
    entries: nextEntries,
  };
}
