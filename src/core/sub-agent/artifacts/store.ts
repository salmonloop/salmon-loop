import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export interface SavedArtifact {
  handle: string;
  mimeType: string;
  sha256: string;
  size: number;
}

const HANDLE_PREFIX = 's8p://artifact/';

function getArtifactsRoot(): string {
  return path.join(tmpdir(), 's8p', 'artifacts');
}

function isWithinDir(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function parseHandle(handle: string): { ok: true; id: string } | { ok: false } {
  if (typeof handle !== 'string') return { ok: false };
  if (!handle.startsWith(HANDLE_PREFIX)) return { ok: false };
  const id = handle.slice(HANDLE_PREFIX.length).trim();
  if (!id) return { ok: false };
  // Tighten to a safe charset to avoid path tricks.
  if (!/^[a-z0-9-]+$/u.test(id)) return { ok: false };
  return { ok: true, id };
}

async function sha256Text(content: string): Promise<string> {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export class ArtifactStore {
  static async saveText(params: {
    content: string;
    mimeType: string;
    fileExt: string;
  }): Promise<SavedArtifact> {
    const { content, mimeType, fileExt } = params;

    const root = getArtifactsRoot();
    await fs.mkdir(root, { recursive: true });

    const id = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    const filePath = path.join(root, `${id}.${fileExt}`);

    await fs.writeFile(filePath, content, 'utf8');

    const stat = await fs.stat(filePath);
    const sha256 = await sha256Text(content);

    return {
      handle: `${HANDLE_PREFIX}${id}`,
      mimeType,
      sha256,
      size: stat.size,
    };
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
}
