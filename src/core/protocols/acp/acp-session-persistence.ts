import type { McpServer } from '@agentclientprotocol/sdk';

import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from '../../adapters/fs/node-fs.js';
import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';

import {
  hashRepoPath,
  isPermissionPolicyValue,
  parseTimestamp,
  type AcpPermissionPolicy,
} from './acp-types.js';
import type { AcpSessionRecord } from './handlers.js';

// ---------------------------------------------------------------------------
// Persisted store types
// ---------------------------------------------------------------------------

type PersistedDeletedSessionRecord = {
  id: string;
  deletedAt: string;
};

type PersistedAcpSessionStoreV1 = {
  schemaVersion: 1;
  sessions: Array<{
    id: string;
    cwd: string;
    mcpServers: McpServer[];
    createdAt: string;
    updatedAt: string;
    title?: string;
  }>;
};

type PersistedAcpSessionStoreV2 = {
  schemaVersion: 2;
  sessions: Array<{
    id: string;
    cwd: string;
    mcpServers: McpServer[];
    createdAt: string;
    updatedAt: string;
    title?: string;
    taskId?: string;
    history?: AcpSessionRecord['history'];
    permissionPolicy?: AcpPermissionPolicy;
    modeId?: unknown;
  }>;
  deletedSessions?: PersistedDeletedSessionRecord[];
};

type PersistedAcpSessionStore = PersistedAcpSessionStoreV1 | PersistedAcpSessionStoreV2;

// ---------------------------------------------------------------------------
// Types shared with caller
// ---------------------------------------------------------------------------

type SessionStorePolicy = {
  maxEntries: number;
  maxAgeMs: number;
  historyMaxEntries: number;
  lockStaleMs: number;
  lockHeartbeatMs: number;
  lockAcquireTimeoutMs: number;
};

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type { SessionStorePolicy };

export interface AcpSessionPersistence {
  hydrate(): Promise<void>;
  persist(): Promise<void>;
  markDeleted(id: string): void;
  getDeletedSessionIds(): ReadonlyMap<string, string>;
}

export function createAcpSessionPersistence(options: {
  path: string;
  storePolicy: SessionStorePolicy;
  defaultPermissionPolicy: AcpPermissionPolicy;
  defaultModeId: unknown;
  sessions: {
    list(): AcpSessionRecord[];
    upsert(session: AcpSessionRecord): void;
    delete(id: string): boolean;
  };
  sessionRuntime: Map<string, { permissionPolicy: AcpPermissionPolicy; modeId: unknown }>;
  isPersistableSession(session: AcpSessionRecord): boolean;
  ensureSessionRuntimeState(sessionId: string): {
    permissionPolicy: AcpPermissionPolicy;
    modeId: unknown;
  };
  resolveExposedAcpModeId(value: unknown, fallback?: unknown): unknown;
}): AcpSessionPersistence {
  const deletedSessionIds = new Map<string, string>();
  let sessionsHydrated = false;
  let hydratePromise: Promise<void> | null = null;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: unknown }).code === 'EPERM'
      ) {
        return true;
      }
      return false;
    }
  }

  function isFileMissing(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ((error as { code?: unknown }).code === 'ENOENT' ||
        (error as { code?: unknown }).code === 'ENOTDIR'),
    );
  }

  function pruneSessionRecords(
    records: PersistedAcpSessionStoreV2['sessions'],
  ): PersistedAcpSessionStoreV2['sessions'] {
    const cutoff = Date.now() - options.storePolicy.maxAgeMs;
    return [...records]
      .filter((record) => parseTimestamp(record.updatedAt) >= cutoff)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt))
      .slice(0, options.storePolicy.maxEntries);
  }

  function normalizeDeletedSessionRecords(input: unknown): PersistedDeletedSessionRecord[] {
    if (!Array.isArray(input)) return [];
    const byId = new Map<string, PersistedDeletedSessionRecord>();
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as { id?: unknown; deletedAt?: unknown };
      if (typeof record.id !== 'string' || !record.id) continue;
      if (typeof record.deletedAt !== 'string' || !record.deletedAt) continue;
      const current = byId.get(record.id);
      if (!current || parseTimestamp(record.deletedAt) > parseTimestamp(current.deletedAt)) {
        byId.set(record.id, { id: record.id, deletedAt: record.deletedAt });
      }
    }
    return Array.from(byId.values());
  }

  function pruneDeletedSessionRecords(records: unknown): PersistedDeletedSessionRecord[] {
    const cutoff = Date.now() - options.storePolicy.maxAgeMs;
    return normalizeDeletedSessionRecords(records)
      .filter((record) => parseTimestamp(record.deletedAt) >= cutoff)
      .sort((a, b) => parseTimestamp(b.deletedAt) - parseTimestamp(a.deletedAt));
  }

  function normalizePersistedSessionStore(input: unknown): PersistedAcpSessionStoreV2 {
    if (!input || typeof input !== 'object') {
      return { schemaVersion: 2, sessions: [] };
    }
    const raw = input as Partial<PersistedAcpSessionStore>;
    if (!Array.isArray(raw.sessions)) return { schemaVersion: 2, sessions: [] };
    if (raw.schemaVersion === 1) {
      return {
        schemaVersion: 2,
        sessions: raw.sessions.map((entry) => ({
          id: entry.id,
          cwd: entry.cwd,
          mcpServers: entry.mcpServers,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          title: entry.title,
          taskId: undefined,
          history: [],
          permissionPolicy: isPermissionPolicyValue(String(options.defaultPermissionPolicy))
            ? options.defaultPermissionPolicy
            : 'ask',
          modeId: options.resolveExposedAcpModeId(options.defaultModeId),
        })),
        deletedSessions: [],
      };
    }
    if (raw.schemaVersion === 2) {
      return {
        schemaVersion: 2,
        sessions: raw.sessions as PersistedAcpSessionStoreV2['sessions'],
        deletedSessions: pruneDeletedSessionRecords(
          (raw as { deletedSessions?: unknown }).deletedSessions,
        ),
      };
    }
    return { schemaVersion: 2, sessions: [] };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async function hydrate(): Promise<void> {
    if (sessionsHydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      sessionsHydrated = true;
      if (!options.path) return;
      try {
        const raw = await readFile(options.path, 'utf8');
        const parsed = normalizePersistedSessionStore(JSON.parse(raw));
        const deletedIds = new Set(parsed.deletedSessions?.map((record) => record.id) ?? []);
        for (const record of parsed.deletedSessions ?? []) {
          deletedSessionIds.set(record.id, record.deletedAt);
        }
        for (const stored of pruneSessionRecords(parsed.sessions)) {
          if (deletedIds.has(stored.id)) continue;
          const runtimeState = {
            permissionPolicy: isPermissionPolicyValue(String(stored.permissionPolicy))
              ? (stored.permissionPolicy as AcpPermissionPolicy)
              : options.defaultPermissionPolicy,
            modeId: options.resolveExposedAcpModeId(stored.modeId, options.defaultModeId),
          };
          options.sessions.upsert({
            id: stored.id,
            cwd: stored.cwd,
            mcpServers: Array.isArray(stored.mcpServers) ? stored.mcpServers : [],
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            title: stored.title,
            taskId: stored.taskId,
            permissionPolicy: runtimeState.permissionPolicy,
            modeId: runtimeState.modeId as string,
            history: Array.isArray(stored.history)
              ? stored.history.slice(-options.storePolicy.historyMaxEntries)
              : [],
            materialized: true,
            cancelRequested: false,
          });
          if (!options.sessionRuntime.has(stored.id)) {
            options.sessionRuntime.set(stored.id, runtimeState);
          }
        }
      } catch (error) {
        if (isFileMissing(error)) return;
        recordAuditEvent(
          'acp.session.hydrate.failed',
          {
            errorName: error instanceof Error ? error.name : typeof error,
          },
          { source: 'acp', severity: 'low', scope: 'session', phase: 'PREFLIGHT' },
        );
      }
    })();
    return hydratePromise;
  }

  async function persist(): Promise<void> {
    if (!options.path) return;
    const dir = defaultPathAdapter.dirname(options.path);
    const lockPath = `${options.path}.lock`;

    const baseRecords = options.sessions
      .list()
      .filter(options.isPersistableSession)
      .map((session) => {
        const runtimeState = options.ensureSessionRuntimeState(session.id);
        return {
          id: session.id,
          cwd: session.cwd,
          mcpServers: session.mcpServers,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          title: session.title,
          taskId: session.taskId,
          history: session.history.slice(-options.storePolicy.historyMaxEntries),
          permissionPolicy: session.permissionPolicy ?? runtimeState.permissionPolicy,
          modeId: session.modeId ?? runtimeState.modeId,
        };
      });
    const prunedRecords = pruneSessionRecords(baseRecords);
    const keepIds = new Set(prunedRecords.map((record) => record.id));
    for (const record of options.sessions.list()) {
      if (options.isPersistableSession(record) && !keepIds.has(record.id)) {
        options.sessions.delete(record.id);
      }
    }

    const payload: PersistedAcpSessionStoreV2 = { schemaVersion: 2, sessions: prunedRecords };
    const payloadDeletedSessions = pruneDeletedSessionRecords(
      Array.from(deletedSessionIds, ([id, deletedAt]) => ({ id, deletedAt })),
    );
    const primaryRepoPath = prunedRecords[0]?.cwd;
    const lockAuditDetails = {
      lockPath,
      lockPathHash: hashRepoPath(lockPath),
      repoPathHash: primaryRepoPath ? hashRepoPath(primaryRepoPath) : undefined,
    };

    const tryClearStaleLock = async (): Promise<void> => {
      try {
        const raw = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { createdAtMs?: number; pid?: number };
        const createdAtMs =
          typeof parsed.createdAtMs === 'number' && Number.isFinite(parsed.createdAtMs)
            ? parsed.createdAtMs
            : null;
        if (createdAtMs === null) return;
        if (Date.now() - createdAtMs <= options.storePolicy.lockStaleMs) return;
        if (typeof parsed.pid === 'number' && isPidAlive(parsed.pid)) return;
        await unlink(lockPath);
        recordAuditEvent('acp.session.lock.stale_reclaimed', lockAuditDetails, {
          source: 'acp',
          severity: 'low',
          scope: 'session',
          phase: 'PREFLIGHT',
        });
      } catch {
        try {
          const lockStat = await stat(lockPath);
          const ageMs = Date.now() - lockStat.mtimeMs;
          if (Number.isFinite(ageMs) && ageMs > options.storePolicy.lockStaleMs * 2) {
            await unlink(lockPath);
            recordAuditEvent(
              'acp.session.lock.corrupted_reclaimed',
              {
                ...lockAuditDetails,
                ageMs: Math.max(0, Math.floor(ageMs)),
              },
              { source: 'acp', severity: 'medium', scope: 'session', phase: 'PREFLIGHT' },
            );
          }
        } catch {
          // ignore
        }
      }
    };

    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(dir, { recursive: true });
      const acquireDeadlineMs =
        Date.now() + Math.max(250, options.storePolicy.lockAcquireTimeoutMs);
      for (let attempt = 0; Date.now() < acquireDeadlineMs; attempt += 1) {
        try {
          lockHandle = await open(lockPath, 'wx');
          await lockHandle.writeFile(
            JSON.stringify({ pid: process.pid, createdAtMs: Date.now() }),
            'utf8',
          );
          break;
        } catch {
          await tryClearStaleLock();
          const delayMs = Math.min(250, 20 * (attempt + 1));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      if (!lockHandle) {
        recordAuditEvent('acp.session.lock.acquire_timeout', lockAuditDetails, {
          source: 'acp',
          severity: 'medium',
          scope: 'session',
          phase: 'PREFLIGHT',
        });
        throw new Error('ACP_SESSION_PERSIST_LOCK_TIMEOUT');
      }

      const heartbeat = setInterval(
        () => {
          void writeFile(
            lockPath,
            JSON.stringify({ pid: process.pid, createdAtMs: Date.now() }),
            'utf8',
          );
        },
        Math.max(1000, options.storePolicy.lockHeartbeatMs),
      );
      const tempPath = defaultPathAdapter.join(
        dir,
        `.sessions.v1.json.tmp-${process.pid}-${Date.now()}`,
      );
      try {
        let existing: PersistedAcpSessionStoreV2 = { schemaVersion: 2, sessions: [] };
        try {
          const existingRaw = await readFile(options.path, 'utf8');
          existing = normalizePersistedSessionStore(JSON.parse(existingRaw));
        } catch {
          // ignore read failure; writing fresh payload is acceptable
        }

        const merged = new Map<string, PersistedAcpSessionStoreV2['sessions'][number]>();
        const mergedDeletedSessions = pruneDeletedSessionRecords([
          ...(existing.deletedSessions ?? []),
          ...payloadDeletedSessions,
        ]);
        const mergedDeletedIds = new Set(mergedDeletedSessions.map((record) => record.id));
        for (const record of mergedDeletedSessions) {
          deletedSessionIds.set(record.id, record.deletedAt);
        }
        for (const entry of existing.sessions) merged.set(entry.id, entry);
        for (const entry of payload.sessions) merged.set(entry.id, entry);
        for (const id of mergedDeletedIds) merged.delete(id);
        const mergedPayload: PersistedAcpSessionStoreV2 = {
          schemaVersion: 2,
          sessions: pruneSessionRecords(Array.from(merged.values())),
          deletedSessions: mergedDeletedSessions,
        };

        await writeFile(tempPath, JSON.stringify(mergedPayload, null, 2), 'utf8');
        await rename(tempPath, options.path);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      recordAuditEvent(
        'acp.session.persist.failed',
        {
          errorName: error instanceof Error ? error.name : typeof error,
        },
        { source: 'acp', severity: 'low', scope: 'session', phase: 'PREFLIGHT' },
      );
    } finally {
      if (lockHandle) {
        try {
          await lockHandle.close();
        } catch {
          // ignore
        }
        try {
          await unlink(lockPath);
        } catch {
          // ignore
        }
      }
    }
  }

  function markDeleted(id: string): void {
    deletedSessionIds.set(id, new Date().toISOString());
  }

  return {
    hydrate,
    persist,
    markDeleted,
    getDeletedSessionIds: () => deletedSessionIds,
  };
}
