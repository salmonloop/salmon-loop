import type { TaskEvent } from '../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../interaction/model/index.js';

import { createAcpSessionStore, isTerminalTaskEvent, type AcpSessionRecord } from './handlers.js';
import { AcpJsonRpcError } from './jsonrpc-error.js';

export type AcpJsonRpcId = string | number | null;

export interface AcpJsonRpcRequest {
  jsonrpc?: '2.0';
  id?: AcpJsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface AcpJsonRpcResponse {
  jsonrpc: '2.0';
  id: AcpJsonRpcId;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

export interface AcpJsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}

const SUPPORTED_PROTOCOL_VERSION = 1;

const DEFAULT_CAPABILITIES = {
  loadSession: true,
  promptCapabilities: {
    image: false,
    audio: false,
    embeddedContext: false,
  },
  mcpCapabilities: {
    http: false,
    sse: false,
  },
  sessionCapabilities: {
    list: {},
    delete: {},
  },
};

type Facade = {
  createTask: (input: { capability: string; request: { instruction: string } }) => Promise<TaskEnvelope>;
  getTask: (id: string) => Promise<TaskEnvelope | null>;
  cancelTask: (id: string) => Promise<TaskEnvelope | null>;
  resumeTask: (id: string) => Promise<TaskEnvelope | null>;
  retryTask: (id: string) => Promise<TaskEnvelope | null>;
  reopenTask: (
    id: string,
    action?: { type: string; reason?: 'approval' | 'clarification' | 'reopen'; prompt: string },
  ) => Promise<TaskEnvelope | null>;
  listTasks: (query?: {
    capability?: string;
    state?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<{ items: TaskEnvelope[]; nextCursor?: string } | TaskEnvelope[]>;
  submitInput: (id: string, input: { type: string; value: string }) => Promise<TaskEnvelope | null>;
  getArtifact: (id: string, artifactId: string) => Promise<TaskEnvelope | null>;
};

function isRequest(value: unknown): value is AcpJsonRpcRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.method === 'string';
}

function resolveId(id: AcpJsonRpcId | undefined): AcpJsonRpcId {
  if (id === undefined) return null;
  return id;
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new AcpJsonRpcError({ code: -32602, message });
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new AcpJsonRpcError({ code: -32602, message });
  }
  return value;
}

function assertArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AcpJsonRpcError({ code: -32602, message });
  }
  return value;
}

function buildTextContentBlock(text: string): Record<string, unknown> {
  return { type: 'text', text };
}

function extractTextFromPrompt(prompt: unknown[]): string {
  const parts: string[] = [];
  for (const entry of prompt) {
    if (!entry || typeof entry !== 'object') continue;
    const block = entry as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function buildSessionUpdate(update: Record<string, unknown>) {
  return update;
}

function buildMessageChunkUpdate(type: 'user_message_chunk' | 'agent_message_chunk', text: string) {
  return buildSessionUpdate({
    sessionUpdate: type,
    content: buildTextContentBlock(text),
  });
}

async function emitSessionUpdate(
  emitNotification: (notification: AcpJsonRpcNotification) => Promise<void>,
  sessionId: string,
  update: Record<string, unknown>,
) {
  await emitNotification({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update },
  });
}

async function awaitTerminalEvent(params: {
  taskId: string;
  eventBus?: {
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
  };
  session: AcpSessionRecord;
}): Promise<TaskEvent | null> {
  if (!params.eventBus) return null;
  return await new Promise((resolve) => {
    const unsubscribe = params.eventBus!.subscribe((event) => {
      if (event.taskId !== params.taskId) return;
      if (!isTerminalTaskEvent(event)) return;
      unsubscribe();
      resolve(event);
    });
  });
}

export function createAcpJsonRpcHandler(deps: {
  agentInfo: { name: string; version: string };
  facade: Facade;
  eventBus?: {
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
    list: (taskId: string, options?: { afterId?: string | null; limit?: number }) => TaskEvent[];
  };
  emitNotification: (notification: AcpJsonRpcNotification) => Promise<void>;
}) {
  const sessions = createAcpSessionStore();

  function buildInitializeResult() {
    return {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      agentCapabilities: DEFAULT_CAPABILITIES,
      agentInfo: deps.agentInfo,
      authMethods: [],
    };
  }

  async function handleSessionNew(params: Record<string, unknown>) {
    const cwd = assertString(params.cwd, 'Invalid params: cwd is required');
    const mcpServers = assertArray(params.mcpServers, 'Invalid params: mcpServers is required');
    const session = sessions.create({ cwd, mcpServers });

    return {
      sessionId: session.id,
    };
  }

  async function handleSessionLoad(params: Record<string, unknown>) {
    const cwd = assertString(params.cwd, 'Invalid params: cwd is required');
    const mcpServers = assertArray(params.mcpServers, 'Invalid params: mcpServers is required');
    const sessionId = assertString(params.sessionId, 'Invalid params: sessionId is required');
    const session = sessions.get(sessionId);
    if (!session) {
      throw new AcpJsonRpcError({ code: -32004, message: `Session not found: ${sessionId}` });
    }

    if (session.cwd !== cwd) {
      sessions.update(sessionId, (current) => ({ ...current, cwd, mcpServers }));
    }

    for (const entry of session.history) {
      const textParts = entry.content
        .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .filter(Boolean);
      if (textParts.length > 0) {
        const updateType = entry.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk';
        await emitSessionUpdate(deps.emitNotification, session.id, {
          sessionUpdate: updateType,
          content: buildTextContentBlock(textParts.join('\n')),
        });
      }
    }

    return {
      sessionId: session.id,
    };
  }

  async function handleSessionPrompt(params: Record<string, unknown>) {
    const sessionId = assertString(params.sessionId, 'Invalid params: sessionId is required');
    const prompt = assertArray(params.prompt, 'Invalid params: prompt is required');
    const session = sessions.get(sessionId);
    if (!session) {
      throw new AcpJsonRpcError({ code: -32004, message: `Session not found: ${sessionId}` });
    }

    const promptText = extractTextFromPrompt(prompt);
    sessions.update(sessionId, (current) => ({
      ...current,
      cancelRequested: false,
      history: [...current.history, { role: 'user', content: prompt as Array<Record<string, unknown>> }],
    }));

    if (promptText.trim().length > 0) {
      await emitSessionUpdate(
        deps.emitNotification,
        sessionId,
        buildMessageChunkUpdate('user_message_chunk', promptText),
      );
    }

    const task = await deps.facade.createTask({
      capability: 'patch',
      request: { instruction: promptText },
    });

    sessions.update(sessionId, (current) => ({ ...current, taskId: task.id }));

    const terminalEvent = await awaitTerminalEvent({ taskId: task.id, eventBus: deps.eventBus, session });
    let stopReason: string = 'end_turn';
    let assistantText = 'Task completed.';

    if (terminalEvent?.type === 'task.failed') {
      assistantText = 'Task failed.';
    } else if (terminalEvent?.type === 'task.awaiting_input') {
      assistantText = 'Task awaiting input.';
    } else if (terminalEvent?.type === 'task.cancelled') {
      assistantText = 'Task cancelled.';
      stopReason = 'cancelled';
    }

    await emitSessionUpdate(
      deps.emitNotification,
      sessionId,
      buildMessageChunkUpdate('agent_message_chunk', assistantText),
    );

    sessions.update(sessionId, (current) => ({
      ...current,
      history: [...current.history, { role: 'assistant', content: [buildTextContentBlock(assistantText)] }],
    }));

    return {
      stopReason,
    };
  }

  async function handleSessionCancel(params: Record<string, unknown>) {
    const sessionId = assertString(params.sessionId, 'Invalid params: sessionId is required');
    const session = sessions.get(sessionId);
    if (!session) return;

    sessions.update(sessionId, (current) => ({ ...current, cancelRequested: true }));
    if (session.taskId) {
      await deps.facade.cancelTask(session.taskId);
    }

    await emitSessionUpdate(
      deps.emitNotification,
      sessionId,
      buildMessageChunkUpdate('agent_message_chunk', 'Cancellation requested.'),
    );
  }

  async function handleSessionList() {
    return {
      sessions: sessions.list().map((session) => ({
        sessionId: session.id,
        cwd: session.cwd,
        title: session.title,
        updatedAt: session.updatedAt,
      })),
    };
  }

  async function handleSessionDelete(params: Record<string, unknown>) {
    const sessionId = assertString(params.sessionId, 'Invalid params: sessionId is required');
    const deleted = sessions.delete(sessionId);
    if (!deleted) {
      throw new AcpJsonRpcError({ code: -32004, message: `Session not found: ${sessionId}` });
    }
    return {};
  }

  return {
    async handle(request: unknown): Promise<AcpJsonRpcResponse | null> {
      if (!isRequest(request)) {
        throw new AcpJsonRpcError({ code: -32600, message: 'Invalid JSON-RPC request' });
      }

      const id = resolveId((request as AcpJsonRpcRequest).id);
      const method = (request as AcpJsonRpcRequest).method;
      const params = assertObject((request as AcpJsonRpcRequest).params ?? {}, 'Invalid params');

      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: buildInitializeResult(),
        };
      }

      if (method === 'session/new') {
        return { jsonrpc: '2.0', id, result: await handleSessionNew(params) };
      }

      if (method === 'session/load') {
        return { jsonrpc: '2.0', id, result: await handleSessionLoad(params) };
      }

      if (method === 'session/prompt') {
        return { jsonrpc: '2.0', id, result: await handleSessionPrompt(params) };
      }

      if (method === 'session/list') {
        return { jsonrpc: '2.0', id, result: await handleSessionList() };
      }

      if (method === 'session/delete') {
        return { jsonrpc: '2.0', id, result: await handleSessionDelete(params) };
      }

      if (method === 'session/cancel') {
        await handleSessionCancel(params);
        return null;
      }

      throw new AcpJsonRpcError({
        code: -32601,
        message: `Method not found: ${method}`,
      });
    },
  };
}
