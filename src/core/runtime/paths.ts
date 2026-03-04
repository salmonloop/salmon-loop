import { createHash } from 'crypto';
import * as os from 'os';
import path from 'path';

import { mkdir, readdir, rename, rm, stat } from '../adapters/fs/node-fs.js';

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export function getRuntimeRoot(repoRoot: string): string {
  return path.join(repoRoot, '.salmonloop', 'runtime');
}

export type AuditScope = 'repo' | 'user';

export function getUserRuntimeRoot(): string {
  return path.join(os.homedir(), '.salmonloop', 'runtime');
}

export function getAuditDir(repoRoot: string, scope: AuditScope = 'repo'): string {
  if (scope === 'user') {
    return path.join(getUserRuntimeRoot(), 'audit');
  }
  return path.join(getRuntimeRoot(repoRoot), 'audit');
}

export function getRejectionsDir(repoRoot: string): string {
  return path.join(getRuntimeRoot(repoRoot), 'rejections');
}

export function getTmpDir(repoRoot: string): string {
  return path.join(getRuntimeRoot(repoRoot), 'tmp');
}

export function getCheckpointsDir(repoRoot: string): string {
  return path.join(getRuntimeRoot(repoRoot), 'checkpoints');
}

export function getUserCheckpointManifestDir(repoRoot: string): string {
  const digest = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(getUserRuntimeRoot(), 'checkpoints', digest);
}

export function getUserAcpSessionStorePath(): string {
  return path.join(getUserRuntimeRoot(), 'acp', 'sessions.v1.json');
}

export function getShadowLockPath(shadowRoot: string): string {
  return path.join(shadowRoot, '.salmonloop', 'runtime', 'locks', 'shadow.lock');
}

export async function migrateLegacyRuntime(repoRoot: string): Promise<void> {
  const legacyRoot = path.join(repoRoot, '.s8p');
  const runtimeRoot = getRuntimeRoot(repoRoot);

  if (!(await pathExists(legacyRoot))) {
    return;
  }

  if (!(await pathExists(runtimeRoot))) {
    await mkdir(path.dirname(runtimeRoot), { recursive: true });
    try {
      await rename(legacyRoot, runtimeRoot);
      return;
    } catch {
      await mkdir(runtimeRoot, { recursive: true });
    }
  }

  const entries = await readdir(legacyRoot, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(legacyRoot, entry.name);
    const to = path.join(runtimeRoot, entry.name);
    if (await pathExists(to)) continue;
    try {
      await rename(from, to);
    } catch {
      // Best-effort migration; keep legacy data if move fails.
    }
  }

  try {
    const remaining = await readdir(legacyRoot);
    if (remaining.length === 0) {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup failures; legacy folder can be removed manually.
  }
}
