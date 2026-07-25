import { createHash, randomBytes } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';

import * as fs from '../../adapters/fs/node-fs.js';
import { LIMITS } from '../../config/limits.js';
import { getLogger } from '../../observability/logger.js';

import { ARTIFACT_HANDLE_PREFIX, ArtifactHandle } from './types.js';

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
  private static gcTimer: NodeJS.Timeout | null = null;

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

    // ⚡ Bolt: Process fs.stat concurrently in chunks to prevent EMFILE limits while speeding up IO
    const CHUNK_SIZE = 10;
    const fileEntries = entries.filter((e) => e.isFile());
    for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
      const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
      const stats = await Promise.all(
        chunk.map(async (entry) => {
          const filePath = path.join(root, entry.name);
          if (!isWithinDir(root, filePath)) return null;
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat) return null;
          return { name: entry.name, path: filePath, mtimeMs: stat.mtimeMs, size: stat.size };
        }),
      );
      for (const stat of stats) {
        if (stat) files.push(stat);
      }
    }

    const maxAgeMs = options?.maxAgeMs ?? LIMITS.artifactTtlMs;
    const maxFiles = options?.maxFiles ?? LIMITS.artifactMaxFiles;
    const maxTotalBytes = options?.maxTotalBytes ?? LIMITS.artifactMaxTotalBytes;

    const nowMs = Date.now();
    const expired = files.filter((f) => nowMs - f.mtimeMs > maxAgeMs);
    const filesToRemove = [...expired];

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
      filesToRemove.push(oldest);
      currentFiles -= 1;
      currentBytes -= oldest.size;
    }

    let removedFiles = 0;
    let removedBytes = 0;

    // ⚡ Bolt: Execute file deletions concurrently in chunks after building the removal queue
    // safely, preventing race conditions during state calculation.
    for (let i = 0; i < filesToRemove.length; i += CHUNK_SIZE) {
      const chunk = filesToRemove.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((file) => fs.rm(file.path, { force: true }).catch(() => null)));
      for (const file of chunk) {
        removedFiles += 1;
        removedBytes += file.size;
      }
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
        getLogger().debug(
          `[ArtifactStore] GC removed ${result.removedFiles} files (${result.removedBytes} bytes)`,
        );
      }
    } catch (error) {
      // Best-effort only; never fail the caller.
      getLogger().debug(
        `[ArtifactStore] GC failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  static ensureGcLoop(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => {
      this.gc().catch(() => undefined);
    }, LIMITS.artifactGcIntervalMs);
    this.gcTimer.unref();
  }
}
