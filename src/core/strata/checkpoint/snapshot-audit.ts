import { createHash } from 'crypto';

function extractSafeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  if (typeof (error as { name?: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }
  return undefined;
}

function hashSafe(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function hashRepoPathForAudit(repoPath: string): string {
  return hashSafe(repoPath);
}

export function classifyGitFailureHint(error: unknown): string | undefined {
  const asRecord = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  if (!asRecord) return undefined;
  const stderr = typeof asRecord.stderr === 'string' ? asRecord.stderr.toLowerCase() : '';
  const message = typeof asRecord.message === 'string' ? asRecord.message.toLowerCase() : '';
  const command = typeof asRecord.command === 'string' ? asRecord.command.toLowerCase() : '';
  const body = `${message}\n${stderr}`;
  if (body.includes('index.lock')) return 'GIT_INDEX_LOCKED';
  if (
    body.includes('you need to resolve your current index first') ||
    body.includes('unmerged files')
  ) {
    return 'GIT_INDEX_UNMERGED';
  }
  if (body.includes('error building trees')) return 'GIT_TREE_BUILD_FAILED';
  if (body.includes('invalid object') || body.includes('invalid sha1 pointer')) {
    return 'GIT_OBJECT_CORRUPTED';
  }
  if (body.includes('not a git repository')) return 'GIT_NOT_REPOSITORY';
  if (body.includes('must be run in a work tree')) return 'GIT_NOT_WORKTREE';
  if (body.includes('detected dubious ownership')) return 'GIT_DUBIOUS_OWNERSHIP';
  if (body.includes('permission denied')) return 'GIT_PERMISSION_DENIED';
  if (
    body.includes('unable to read index file') ||
    body.includes('index file smaller than expected') ||
    body.includes('bad index file') ||
    body.includes('index file corrupt')
  ) {
    return 'GIT_INDEX_CORRUPTED';
  }
  if (body.includes('unable to write new index file') || body.includes('could not write index')) {
    return 'GIT_INDEX_WRITE_FAILED';
  }
  if (body.includes('no space left on device')) return 'GIT_NO_SPACE';
  if (command.includes('write-tree') && body.includes('fatal:')) return 'GIT_WRITE_TREE_FATAL';
  return 'GIT_FAILURE_UNKNOWN';
}

export function extractSafeSnapshotErrorSummary(error: unknown): {
  errorCode?: string;
  errorName?: string;
  errorHintCode?: string;
  errorFingerprint?: string;
  stderrFingerprint?: string;
  commandFingerprint?: string;
  writeTreeAttempts?: number;
} {
  if (!error || typeof error !== 'object') {
    return {
      errorName: typeof error,
    };
  }
  const asRecord = error as Record<string, unknown>;
  const safe: {
    errorCode?: string;
    errorName?: string;
    errorHintCode?: string;
    errorFingerprint?: string;
    stderrFingerprint?: string;
    commandFingerprint?: string;
    writeTreeAttempts?: number;
  } = {
    errorCode: extractSafeErrorCode(error),
    errorName: typeof asRecord.name === 'string' ? asRecord.name : undefined,
    errorHintCode: classifyGitFailureHint(error),
    writeTreeAttempts:
      typeof asRecord.writeTreeAttempts === 'number' ? asRecord.writeTreeAttempts : undefined,
  };
  if (typeof asRecord.message === 'string' && asRecord.message.length > 0) {
    safe.errorFingerprint = hashSafe(asRecord.message);
  }
  if (typeof asRecord.stderr === 'string' && asRecord.stderr.length > 0) {
    const firstLine = asRecord.stderr.split('\n')[0] ?? '';
    if (firstLine.length > 0) {
      safe.stderrFingerprint = hashSafe(firstLine);
    }
  }
  if (typeof asRecord.command === 'string' && asRecord.command.length > 0) {
    safe.commandFingerprint = hashSafe(asRecord.command);
  }
  return safe;
}
