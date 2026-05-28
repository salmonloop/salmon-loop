import { randomUUID } from 'node:crypto';

import type { McpServer } from '@agentclientprotocol/sdk';

import type { TaskEvent } from '../../interaction/events/bus.js';

import type { AcpPermissionPolicy } from './acp-types.js';

export type AcpSessionHistoryEntry = {
  role: 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
};

export type AcpSessionRecord = {
  id: string;
  cwd: string;
  mcpServers: McpServer[];
  createdAt: string;
  updatedAt: string;
  title?: string;
  taskId?: string;
  permissionPolicy?: AcpPermissionPolicy;
  modeId?: string;
  history: AcpSessionHistoryEntry[];
  materialized: boolean;
  cancelRequested: boolean;
};

export type AcpSessionStore = {
  create: (input: {
    cwd: string;
    mcpServers: McpServer[];
    title?: string;
    permissionPolicy?: AcpSessionRecord['permissionPolicy'];
    modeId?: AcpSessionRecord['modeId'];
  }) => AcpSessionRecord;
  upsert: (session: AcpSessionRecord) => AcpSessionRecord;
  get: (id: string) => AcpSessionRecord | undefined;
  update: (
    id: string,
    mutate: (session: AcpSessionRecord) => AcpSessionRecord,
  ) => AcpSessionRecord | undefined;
  list: () => AcpSessionRecord[];
  delete: (id: string) => boolean;
};

export function createAcpSessionStore(): AcpSessionStore {
  const sessions = new Map<string, AcpSessionRecord>();

  return {
    create(input) {
      const now = new Date().toISOString();
      const id = `sess_${Date.now()}_${process.pid}_${randomUUID()}`;
      const session: AcpSessionRecord = {
        id,
        cwd: input.cwd,
        mcpServers: input.mcpServers,
        createdAt: now,
        updatedAt: now,
        title: input.title,
        permissionPolicy: input.permissionPolicy,
        modeId: input.modeId,
        history: [],
        materialized: false,
        cancelRequested: false,
      };
      sessions.set(id, session);
      return session;
    },
    upsert(session) {
      sessions.set(session.id, session);
      return session;
    },
    get(id) {
      return sessions.get(id);
    },
    update(id, mutate) {
      const current = sessions.get(id);
      if (!current) return undefined;
      const updated = mutate(current);
      const nextUpdatedAt = new Date().toISOString();
      updated.updatedAt =
        nextUpdatedAt > current.updatedAt
          ? nextUpdatedAt
          : new Date(Date.parse(current.updatedAt) + 1).toISOString();
      sessions.set(id, updated);
      return updated;
    },
    list() {
      return Array.from(sessions.values());
    },
    delete(id) {
      return sessions.delete(id);
    },
  };
}

export function isTerminalTaskEvent(event: TaskEvent): boolean {
  return (
    event.type === 'task.completed' ||
    event.type === 'task.failed' ||
    event.type === 'task.awaiting_input' ||
    event.type === 'task.cancelled'
  );
}
