import { mkdir, open, readFile, rename, unlink, writeFile } from '../adapters/fs/node-fs.js';
import { defaultPathAdapter } from '../adapters/path/path-adapter.js';
import { getUserCheckpointManifestDir } from '../runtime/paths.js';

import type { CheckpointHandle, SessionCheckpointLink } from './types.js';

const CHECKPOINT_MANIFEST_FILENAME = 'manifest.v1.json';

interface CheckpointManifestV1 {
  schemaVersion: 1 | 2;
  revision?: number;
  checkpoints: Record<string, CheckpointHandle>;
  sessions: Record<string, SessionCheckpointLink>;
  checkpointLineage?: Record<string, { parentId?: string }>;
}

interface CheckpointManifestV2 {
  schemaVersion: 2;
  revision?: number;
  checkpoints: Record<string, CheckpointHandle>;
  sessions: Record<string, SessionCheckpointLink>;
  checkpointLineage?: Record<string, { parentId?: string }>;
}

type AnyCheckpointManifest = CheckpointManifestV1 | CheckpointManifestV2;

function createEmptyManifest(): CheckpointManifestV1 {
  return {
    schemaVersion: 2,
    revision: 0,
    checkpoints: {},
    sessions: {},
    checkpointLineage: {},
  };
}

function normalizeManifest(input: unknown): CheckpointManifestV1 {
  if (!input || typeof input !== 'object') return createEmptyManifest();
  const parsed = input as Partial<AnyCheckpointManifest>;
  if (!parsed.checkpoints || !parsed.sessions) return createEmptyManifest();

  if (parsed.schemaVersion === 1) {
    return {
      schemaVersion: 2,
      revision: parsed.revision ?? 0,
      checkpoints: parsed.checkpoints,
      sessions: parsed.sessions,
      checkpointLineage: parsed.checkpointLineage ?? {},
    };
  }

  if (parsed.schemaVersion === 2) {
    // Lightweight compatibility migrator:
    // v2 may carry extra lineage metadata; v1 runtime can ignore it safely.
    return {
      schemaVersion: 2,
      revision: parsed.revision ?? 0,
      checkpoints: parsed.checkpoints,
      sessions: parsed.sessions,
      checkpointLineage: parsed.checkpointLineage ?? {},
    };
  }

  return createEmptyManifest();
}

function toManifestPath(repoPath: string): string {
  return defaultPathAdapter.join(
    getUserCheckpointManifestDir(repoPath),
    CHECKPOINT_MANIFEST_FILENAME,
  );
}

async function writeManifestAtomic(
  manifestPath: string,
  manifest: CheckpointManifestV1,
): Promise<void> {
  const dir = defaultPathAdapter.dirname(manifestPath);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(manifest, null, 2);
  const tmpPath = defaultPathAdapter.join(
    dir,
    `.${defaultPathAdapter.basename(manifestPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, manifestPath);
}

async function withManifestLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
  const dir = getUserCheckpointManifestDir(repoPath);
  await mkdir(dir, { recursive: true });
  const lockPath = defaultPathAdapter.join(dir, '.manifest.lock');

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
  }
  if (!handle) {
    // Best-effort fallback when lock cannot be acquired.
    return operation();
  }

  try {
    return await operation();
  } finally {
    try {
      await handle.close();
    } catch {
      // ignore
    }
    try {
      await unlink(lockPath);
    } catch {
      // ignore
    }
  }
}

export async function readCheckpointManifest(repoPath: string): Promise<CheckpointManifestV1> {
  const manifestPath = toManifestPath(repoPath);
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return normalizeManifest(JSON.parse(raw));
  } catch {
    return createEmptyManifest();
  }
}

export async function upsertCheckpointHandle(
  repoPath: string,
  handle: CheckpointHandle,
): Promise<void> {
  await withManifestLock(repoPath, async () => {
    const manifestPath = toManifestPath(repoPath);
    const manifest = await readCheckpointManifest(repoPath);
    manifest.checkpoints[handle.id] = handle;
    if (!manifest.checkpointLineage) manifest.checkpointLineage = {};
    manifest.checkpointLineage[handle.id] = { parentId: handle.parentId };
    manifest.revision = (manifest.revision ?? 0) + 1;
    await writeManifestAtomic(manifestPath, manifest);
  });
}

export async function linkSessionToCheckpoint(
  repoPath: string,
  sessionId: string,
  checkpointId: string,
): Promise<void> {
  await withManifestLock(repoPath, async () => {
    const manifestPath = toManifestPath(repoPath);
    const manifest = await readCheckpointManifest(repoPath);
    const existing = manifest.sessions[sessionId] ?? { sessionId, history: [] };
    if (existing.history.at(-1) !== checkpointId) {
      existing.history.push(checkpointId);
    }
    existing.currentCheckpointId = checkpointId;
    manifest.sessions[sessionId] = existing;
    manifest.revision = (manifest.revision ?? 0) + 1;
    await writeManifestAtomic(manifestPath, manifest);
  });
}

export async function removeCheckpointHandle(
  repoPath: string,
  checkpointId: string,
): Promise<void> {
  await withManifestLock(repoPath, async () => {
    const manifestPath = toManifestPath(repoPath);
    const manifest = await readCheckpointManifest(repoPath);
    delete manifest.checkpoints[checkpointId];
    if (manifest.checkpointLineage) {
      delete manifest.checkpointLineage[checkpointId];
    }
    for (const session of Object.values(manifest.sessions)) {
      session.history = session.history.filter((id) => id !== checkpointId);
      if (session.currentCheckpointId === checkpointId) {
        session.currentCheckpointId = session.history.at(-1);
      }
    }
    manifest.revision = (manifest.revision ?? 0) + 1;
    await writeManifestAtomic(manifestPath, manifest);
  });
}

export type CheckpointProbeReason = 'ok' | 'not_found' | 'manifest_unavailable';

export async function probeCheckpointHandle(
  repoPath: string,
  checkpointId: string,
): Promise<{ handle: CheckpointHandle | null; reason: CheckpointProbeReason }> {
  try {
    const manifest = await readCheckpointManifest(repoPath);
    const handle = manifest.checkpoints[checkpointId] ?? null;
    if (!handle) return { handle: null, reason: 'not_found' };
    return { handle, reason: 'ok' };
  } catch {
    return { handle: null, reason: 'manifest_unavailable' };
  }
}

export async function garbageCollectManifest(
  repoPath: string,
  options: { olderThanMs?: number; maxPerSession?: number } = {},
): Promise<{ removed: number }> {
  const olderThanMs = options.olderThanMs ?? 1000 * 60 * 60 * 24 * 14;
  const maxPerSession = options.maxPerSession ?? 30;
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;

  await withManifestLock(repoPath, async () => {
    const manifestPath = toManifestPath(repoPath);
    const manifest = await readCheckpointManifest(repoPath);
    const protectedIds = new Set<string>();
    for (const session of Object.values(manifest.sessions)) {
      const sorted = [...session.history]
        .map((id) => manifest.checkpoints[id])
        .filter((v): v is CheckpointHandle => Boolean(v))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      for (const item of sorted.slice(0, maxPerSession)) protectedIds.add(item.id);
      if (session.currentCheckpointId) protectedIds.add(session.currentCheckpointId);
    }

    for (const [id, handle] of Object.entries(manifest.checkpoints)) {
      const created = Date.parse(handle.createdAt);
      if (protectedIds.has(id)) continue;
      if (Number.isFinite(created) && created >= cutoff) continue;
      delete manifest.checkpoints[id];
      if (manifest.checkpointLineage) delete manifest.checkpointLineage[id];
      removed += 1;
    }
    if (removed > 0) {
      manifest.revision = (manifest.revision ?? 0) + 1;
      await writeManifestAtomic(manifestPath, manifest);
    }
  });

  return { removed };
}
