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

function createEmptyManifest(): CheckpointManifestV1 {
  return {
    schemaVersion: 1,
    checkpoints: {},
    sessions: {},
  };
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
    const parsed = JSON.parse(raw) as CheckpointManifestV1;
    if (parsed?.schemaVersion !== 1 || !parsed.checkpoints || !parsed.sessions) {
      return createEmptyManifest();
    }
    return parsed;
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
