import { join } from 'path';

import { stat } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';

import { classifyGitFailureHint } from './snapshot-audit.js';

export async function tryWriteTreeWithRetry(
  git: GitAdapter,
  retryDelaysMs: readonly number[],
): Promise<{ tree: string; attempts: number }> {
  let attempts = 0;
  let lastError: unknown;
  for (let i = 0; i <= retryDelaysMs.length; i += 1) {
    attempts = i + 1;
    try {
      return { tree: (await git.query(['write-tree'])).trim(), attempts };
    } catch (error) {
      lastError = error;
      if (i >= retryDelaysMs.length) break;
      if (retryDelaysMs[i] > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[i]));
      }
    }
  }
  throw Object.assign(lastError instanceof Error ? lastError : new Error('write-tree failed'), {
    writeTreeAttempts: attempts,
  });
}

export async function probeWriteTreeFailure(git: GitAdapter): Promise<Record<string, unknown>> {
  const details: Record<string, unknown> = {};
  const indexLockPath = join(git.repoPath, '.git', 'index.lock');
  try {
    const lockStat = await stat(indexLockPath);
    details.indexLockPresent = true;
    details.indexLockAgeMs = Math.max(0, Math.floor(Date.now() - lockStat.mtimeMs));
  } catch {
    details.indexLockPresent = false;
  }
  try {
    const unmergedRaw = await git.exec(['ls-files', '-u'], { allowError: true });
    const count = unmergedRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;
    details.unmergedCount = count;
  } catch {
    details.unmergedCount = undefined;
  }
  try {
    const insideMeta = await git.execMeta(['rev-parse', '--is-inside-work-tree']);
    if (insideMeta.ok) {
      details.isInsideWorkTree = insideMeta.stdout.toString('utf8').trim() === 'true';
    } else {
      details.isInsideWorkTree = false;
      details.spawnErrorCode =
        typeof insideMeta.error?.code === 'string' ? insideMeta.error.code : undefined;
      details.workTreeProbeErrorCode =
        insideMeta.error?.code ||
        (typeof insideMeta.code === 'number' ? `EXIT_${insideMeta.code}` : undefined);
      details.workTreeProbeHintCode = classifyGitFailureHint({
        message:
          insideMeta.error?.message ||
          (typeof insideMeta.code === 'number'
            ? `rev-parse exited ${insideMeta.code}`
            : 'rev-parse failed'),
        stderr: insideMeta.stderr,
        command: 'rev-parse --is-inside-work-tree',
      });
    }
  } catch {
    details.isInsideWorkTree = undefined;
  }
  return details;
}
