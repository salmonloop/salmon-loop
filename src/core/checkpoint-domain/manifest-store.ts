import { mkdir, readFile, rename, writeFile } from '../adapters/fs/node-fs.js';
import { defaultPathAdapter } from '../adapters/path/path-adapter.js';
import { getUserCheckpointManifestDir } from '../runtime/paths.js';

import type { CheckpointHandle, SessionCheckpointLink } from './types.js';

const CHECKPOINT_MANIFEST_FILENAME = 'manifest.v1.json';

interface CheckpointManifestV1 {
  schemaVersion: 1;
  checkpoints: Record<string, CheckpointHandle>;
  sessions: Record<string, SessionCheckpointLink>;
}

interface CheckpointManifestV2 {
  schemaVersion: 2;
  checkpoints: Record<string, CheckpointHandle>;
  sessions: Record<string, SessionCheckpointLink>;
  checkpointLineage?: Record<string, { parentId?: string }>;
}

type AnyCheckpointManifest = CheckpointManifestV1 | CheckpointManifestV2;

function createEmptyManifest(): CheckpointManifestV1 {
  return {
    schemaVersion: 1,
    checkpoints: {},
    sessions: {},
  };
}

function normalizeManifest(input: unknown): CheckpointManifestV1 {
  if (!input || typeof input !== 'object') return createEmptyManifest();
  const parsed = input as Partial<AnyCheckpointManifest>;
  if (!parsed.checkpoints || !parsed.sessions) return createEmptyManifest();

  if (parsed.schemaVersion === 1) {
    return {
      schemaVersion: 1,
      checkpoints: parsed.checkpoints,
      sessions: parsed.sessions,
    };
  }

  if (parsed.schemaVersion === 2) {
    // Lightweight compatibility migrator:
    // v2 may carry extra lineage metadata; v1 runtime can ignore it safely.
    return {
      schemaVersion: 1,
      checkpoints: parsed.checkpoints,
      sessions: parsed.sessions,
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
  const manifestPath = toManifestPath(repoPath);
  const manifest = await readCheckpointManifest(repoPath);
  manifest.checkpoints[handle.id] = handle;
  await writeManifestAtomic(manifestPath, manifest);
}

export async function linkSessionToCheckpoint(
  repoPath: string,
  sessionId: string,
  checkpointId: string,
): Promise<void> {
  const manifestPath = toManifestPath(repoPath);
  const manifest = await readCheckpointManifest(repoPath);
  const existing = manifest.sessions[sessionId] ?? { sessionId, history: [] };
  if (existing.history.at(-1) !== checkpointId) {
    existing.history.push(checkpointId);
  }
  existing.currentCheckpointId = checkpointId;
  manifest.sessions[sessionId] = existing;
  await writeManifestAtomic(manifestPath, manifest);
}

export async function removeCheckpointHandle(
  repoPath: string,
  checkpointId: string,
): Promise<void> {
  const manifestPath = toManifestPath(repoPath);
  const manifest = await readCheckpointManifest(repoPath);
  delete manifest.checkpoints[checkpointId];
  for (const session of Object.values(manifest.sessions)) {
    session.history = session.history.filter((id) => id !== checkpointId);
    if (session.currentCheckpointId === checkpointId) {
      session.currentCheckpointId = session.history.at(-1);
    }
  }
  await writeManifestAtomic(manifestPath, manifest);
}
