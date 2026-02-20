import { createHash, randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { getAuditDir } from '../runtime/paths.js';
import type { DebugArtifactRef } from '../types/index.js';

const MAX_DEBUG_CHARS = 16_384;

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = new RegExp('\\u001b\\[[0-9;]*m', 'g');

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    out += code < 32 || code === 127 ? ' ' : input[i];
  }
  return out;
}

function truncate(input: string, maxChars: number): { text: string; truncated: boolean } {
  if (input.length <= maxChars) return { text: input, truncated: false };
  return { text: input.slice(0, Math.max(0, maxChars - 3)) + '...', truncated: true };
}

function redactSecrets(input: string): string {
  let out = input;
  out = out.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, '[REDACTED]');
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
  out = out.replace(/\bASIA[0-9A-Z]{16}\b/g, '[REDACTED]');
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/g, 'Bearer [REDACTED]');
  out = out.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
  out = out.replace(/\bgho_[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
  out = out.replace(/\bghu_[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
  out = out.replace(/\bghs_[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]');
  return out;
}

function formatTimestampForFilename(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-');
}

export async function writeDebugArtifact(params: {
  repoRoot: string;
  prefix: string;
  content: string;
}): Promise<DebugArtifactRef | null> {
  const { repoRoot, prefix, content } = params;

  const auditDir = getAuditDir(repoRoot);
  const blobsDir = path.join(auditDir, 'blobs');
  await mkdir(blobsDir, { recursive: true });

  const timestamp = formatTimestampForFilename(new Date());
  const nonce = randomBytes(4).toString('hex');
  const fileName = `${prefix}-${timestamp}-${nonce}.log`;
  const absolutePath = path.join(blobsDir, fileName);
  const relativePath = path.join('blobs', fileName);

  let payload = String(content ?? '');
  payload = payload.replace(ANSI_REGEX, '');
  payload = stripControlChars(payload);
  payload = redactSecrets(payload);

  const truncated = truncate(payload, MAX_DEBUG_CHARS);
  payload = truncated.text;

  const sha256 = createHash('sha256').update(payload).digest('hex');
  await writeFile(absolutePath, payload, 'utf8');

  return {
    path: relativePath,
    sha256,
    chars: payload.length,
  };
}
