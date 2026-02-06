import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { LIMITS } from '../../limits.js';
import { logger } from '../../logger.js';

import { ARTIFACT_HANDLE_PREFIX, ArtifactHandle } from './types.js';

export type SavedArtifact = ArtifactHandle;

function getArtifactsRoot(): string {
  // Directory naming uses "salmonloop"; protocol handles use the short "s8p://" scheme.
  return path.join(tmpdir(), 'salmonloop', 'artifacts');
}

function isWithinDir(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function parseHandle(handle: string): { ok: true; id: string } | { ok: false } {
  if (typeof handle !== 'string') return { ok: false };
  if (!handle.startsWith(ARTIFACT_HANDLE_PREFIX)) return { ok: false };
  const id = handle.slice(ARTIFACT_HANDLE_PREFIX.length).trim();
  if (!id) return { ok: false };
  // Tighten to a safe charset to avoid path tricks.
  if (!/^[a-z0-9-]+$/u.test(id)) return { ok: false };
  return { ok: true, id };
}

async function sha256Text(content: string): Promise<string> {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class ArtifactStore {
  private static lastGcAtMs = 0;

  static async saveText(params: {
    content: string;
    mimeType: string;
    fileExt: string;
  }): Promise<ArtifactHandle> {
    const { content, mimeType, fileExt } = params;

    const root = getArtifactsRoot();
    await fs.mkdir(root, { recursive: true });

    const id = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    const filePath = path.join(root, `${id}.${fileExt}`);

    await fs.writeFile(filePath, content, 'utf8');

    const stat = await fs.stat(filePath);
    const sha256 = await sha256Text(content);

    const saved: ArtifactHandle = {
      handle: `${ARTIFACT_HANDLE_PREFIX}${id}`,
      mimeType,
      sha256,
      size: stat.size,
    };

    await this.maybeGc();
    return saved;
  }

  static async readText(
    handle: string,
  ): Promise<{ ok: true; content: string; size: number } | { ok: false }> {
    const parsed = parseHandle(handle);
    if (!parsed.ok) return { ok: false };

    const root = getArtifactsRoot();
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const match = entries.find((e) => e.isFile() && e.name.startsWith(`${parsed.id}.`));
    if (!match) return { ok: false };

    const filePath = path.join(root, match.name);
    if (!isWithinDir(root, filePath)) return { ok: false };

    const content = await fs.readFile(filePath, 'utf8');
    const stat = await fs.stat(filePath);
    return { ok: true, content, size: stat.size };
  }

  static async gc(options?: {
    maxAgeMs?: number;
    maxFiles?: number;
    maxTotalBytes?: number;
  }): Promise<{ removedFiles: number; removedBytes: number }> {
    const root = getArtifactsRoot();
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);

    const files: Array<{ name: string; path: string; mtimeMs: number; size: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(root, entry.name);
      if (!isWithinDir(root, filePath)) continue;
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) continue;
      files.push({ name: entry.name, path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
    }

    const maxAgeMs = options?.maxAgeMs ?? LIMITS.artifactTtlMs;
    const maxFiles = options?.maxFiles ?? LIMITS.artifactMaxFiles;
    const maxTotalBytes = options?.maxTotalBytes ?? LIMITS.artifactMaxTotalBytes;

    const nowMs = Date.now();
    const expired = files.filter((f) => nowMs - f.mtimeMs > maxAgeMs);

    let removedFiles = 0;
    let removedBytes = 0;

    const removeFile = async (file: { path: string; size: number }) => {
      await fs.rm(file.path, { force: true }).catch(() => null);
      removedFiles += 1;
      removedBytes += file.size;
    };

    for (const file of expired) {
      await removeFile(file);
    }

    // Recompute remaining after TTL removal (newest first).
    const remaining = files
      .filter((f) => !(nowMs - f.mtimeMs > maxAgeMs))
      .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

    let currentFiles = remaining.length;
    let currentBytes = remaining.reduce((acc, f) => acc + f.size, 0);

    for (let i = remaining.length - 1; i >= 0; i--) {
      const tooManyFiles = currentFiles > maxFiles;
      const tooManyBytes = currentBytes > maxTotalBytes;
      if (!tooManyFiles && !tooManyBytes) break;

      const oldest = remaining[i];
      await removeFile(oldest);
      currentFiles -= 1;
      currentBytes -= oldest.size;
    }

    return { removedFiles, removedBytes };
  }

  private static async maybeGc(): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - this.lastGcAtMs < LIMITS.artifactGcIntervalMs) return;
    this.lastGcAtMs = nowMs;

    try {
      const result = await this.gc();
      if (result.removedFiles > 0) {
        logger.debug(
          `[ArtifactStore] GC removed ${result.removedFiles} files (${result.removedBytes} bytes)`,
        );
      }
    } catch {
      // Best-effort only; never fail the caller.
    }
  }
}
