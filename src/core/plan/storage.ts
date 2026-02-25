import { randomBytes, createHash } from 'crypto';
import path from 'path';

import { mkdir, readFile, rename, stat, writeFile } from '../adapters/fs/node-fs.js';

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error('Invalid sessionId (expected 6-64 chars of [a-zA-Z0-9_-]).');
  }
}

export function resolvePlanFilePath(params: { persistenceRoot: string; sessionId: string }): {
  planDir: string;
  planFile: string;
  planFileRelHint: string;
} {
  const { persistenceRoot, sessionId } = params;
  assertValidSessionId(sessionId);

  const planDir = path.resolve(persistenceRoot, '.salmonloop', 'plans', sessionId);
  const planFile = path.join(planDir, 'SALMONLOOP_PLAN.md');
  const planFileRelHint = path.posix.join('.salmonloop', 'plans', sessionId, 'SALMONLOOP_PLAN.md');
  return { planDir, planFile, planFileRelHint };
}

export async function readPlanFile(planFile: string): Promise<string> {
  return readFile(planFile, 'utf-8');
}

export async function writePlanFileAtomic(planDir: string, planFile: string, content: string) {
  await mkdir(planDir, { recursive: true });

  const tmp = path.join(planDir, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}.md`);
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, planFile);
}

async function resolveGitDir(repoRoot: string): Promise<string | null> {
  const dotGit = path.join(repoRoot, '.git');
  try {
    const st = await stat(dotGit);
    if (st.isDirectory()) return dotGit;
  } catch {
    // ignore
  }

  try {
    const raw = await readFile(dotGit, 'utf-8');
    const line = raw.split('\n')[0] ?? '';
    const m = line.match(/^gitdir:\s*(.+)\s*$/);
    if (!m) return null;
    const gitdir = m[1].trim();
    return path.isAbsolute(gitdir) ? gitdir : path.resolve(repoRoot, gitdir);
  } catch {
    return null;
  }
}

/**
 * Ensure `.salmonloop/` is ignored locally so runtime artifacts do not dirty user repos.
 * Uses `.git/info/exclude` (local-only) rather than modifying tracked `.gitignore`.
 */
export async function ensureSalmonloopIgnored(repoRoot: string): Promise<void> {
  const gitDir = await resolveGitDir(repoRoot);
  if (!gitDir) return;
  const excludePath = path.join(gitDir, 'info', 'exclude');

  await mkdir(path.dirname(excludePath), { recursive: true });
  let existing = '';
  try {
    existing = await readFile(excludePath, 'utf-8');
  } catch {
    existing = '';
  }

  if (existing.split('\n').some((l) => l.trim() === '.salmonloop/')) return;
  const next = `${existing.replace(/\s*$/, '')}\n.salmonloop/\n`;
  await writeFile(excludePath, next, 'utf-8');
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
