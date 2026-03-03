import {
  PROTOCOL_VERSION,
  RequestError,
  type Agent,
  type AgentSideConnection,
  type ClientCapabilities,
  type ContentBlock,
  type LoadSessionRequest,
  type SessionConfigOption,
  type SessionUpdate,
  type StopReason,
  type ToolKind,
} from '@agentclientprotocol/sdk';

import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import type { TaskEvent } from '../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../interaction/model/index.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import type { FileSystem } from '../../types/index.js';
import type { LoopEvent } from '../../types/index.js';

import { createAcpCommandRunner } from './acp-command-runner.js';
import { createAcpFileSystem } from './acp-filesystem.js';
import { createAcpSessionStore, isTerminalTaskEvent, type AcpSessionRecord } from './handlers.js';
import { createAcpToolAuthorizationProvider } from './permission-provider.js';

type Facade = {
  createTask: (input: {
    capability: string;
    request: { instruction: string };
    onEvent?: (event: LoopEvent) => void;
    authorizationProvider?: import('../../tools/authorization/types.js').ToolAuthorizationProvider;
    authorizationMode?: 'blocking' | 'deferred';
    commandRunner?: CommandRunner;
    fileSystemOverride?: FileSystem;
  }) => Promise<{ task: TaskEnvelope; signal: AbortSignal }>;
  getTask: (id: string) => Promise<TaskEnvelope | null>;
  cancelTask: (id: string) => Promise<TaskEnvelope | null>;
  resumeTask: (id: string) => Promise<TaskEnvelope | null>;
  retryTask: (id: string) => Promise<TaskEnvelope | null>;
  reopenTask: (
    id: string,
    action: { type: string; reason?: 'approval' | 'clarification' | 'reopen'; prompt: string },
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

type AcpPlanEntry = {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
};

type AcpPermissionPolicy = 'ask' | 'deny_all';

type AcpSessionRuntimeState = {
  planEntries: Map<string, AcpPlanEntry>;
  lastPlanDigest: string | null;
  lastCommandsDigest: string | null;
  lastConfigDigest: string | null;
  permissionPolicy: AcpPermissionPolicy;
  // Reserved for future protocol-compliant mode integration.
  modeReserved: {
    availableModes: Array<{ id: string; name: string }>;
    currentModeId: string | null;
  };
};

const ACP_PERMISSION_POLICY_CONFIG_ID = '_salmonloop_permission_policy';
const ACP_PERMISSION_POLICY_ASK: AcpPermissionPolicy = 'ask';
const ACP_PERMISSION_POLICY_DENY_ALL: AcpPermissionPolicy = 'deny_all';

function isAbsolutePath(filePath: string): boolean {
  if (defaultPathAdapter.isAbsolute(filePath)) return true;
  // Cross-platform absolute check for Windows paths on non-Windows runtimes.
  // ACP requires absolute paths, but the runtime OS may not match the client OS.
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) return true; // drive letter
  if (filePath.startsWith('\\\\')) return true; // UNC path
  return false;
}

function ensureMarkdownParagraphBreak(text: string): string {
  if (!text) return text;
  const trimmed = text.replace(/\r?\n$/, '');
  return `${trimmed}\n\n`;
}

function buildTextContentBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

function extractTextFromPrompt(prompt: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of prompt) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n');
}

function mapToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (name.includes('read') || name.includes('get') || name.includes('view')) return 'read';
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'edit';
  if (name.includes('delete') || name.includes('remove') || name.includes('rm')) return 'delete';
  return 'execute';
}

function loopEventToSessionUpdate(event: LoopEvent): SessionUpdate | null {
  switch (event.type) {
    case 'llm.stream.delta':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: buildTextContentBlock(event.content || ''),
      };
    case 'llm.output':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: buildTextContentBlock(event.content || ''),
      };
    case 'tool.call.start':
      return {
        sessionUpdate: 'tool_call',
        toolCallId: event.callId,
        status: 'in_progress',
        title: event.toolName,
        kind: mapToolKind(event.toolName),
      };
    case 'tool.call.end':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.callId,
        status: event.status === 'ok' ? 'completed' : 'failed',
      };
    case 'phase.start':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: buildTextContentBlock(ensureMarkdownParagraphBreak(`Starting ${event.phase}...`)),
      };
    case 'phase.end':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: buildTextContentBlock(
          ensureMarkdownParagraphBreak(
            event.success ? `${event.phase} completed` : `${event.phase} failed`,
          ),
        ),
      };
    case 'log':
      if (event.level === 'error' || event.level === 'warn') {
        return {
          sessionUpdate: 'agent_message_chunk',
          content: buildTextContentBlock(
            ensureMarkdownParagraphBreak(`[${event.level.toUpperCase()}] ${event.message}`),
          ),
        };
      }
      return null;
    default:
      return null;
  }
}

function createSessionRuntimeState(): AcpSessionRuntimeState {
  const permissionPolicy = ACP_PERMISSION_POLICY_ASK;
  return {
    planEntries: new Map(),
    lastPlanDigest: null,
    lastCommandsDigest: null,
    lastConfigDigest: JSON.stringify(
      buildConfigOptionsFromPolicy(permissionPolicy as AcpPermissionPolicy),
    ),
    permissionPolicy,
    modeReserved: {
      availableModes: [],
      currentModeId: null,
    },
  };
}

function isPermissionPolicyValue(value: string): value is AcpPermissionPolicy {
  return value === ACP_PERMISSION_POLICY_ASK || value === ACP_PERMISSION_POLICY_DENY_ALL;
}

function buildConfigOptionsFromPolicy(
  permissionPolicy: AcpPermissionPolicy,
): SessionConfigOption[] {
  return [
    {
      type: 'select',
      id: ACP_PERMISSION_POLICY_CONFIG_ID,
      name: 'Permission Policy',
      description: 'How side-effecting operations should be authorized for this session.',
      currentValue: permissionPolicy,
      options: [
        {
          value: ACP_PERMISSION_POLICY_ASK,
          name: 'Ask User',
          description: 'Request user permission for side-effecting operations.',
        },
        {
          value: ACP_PERMISSION_POLICY_DENY_ALL,
          name: 'Deny All',
          description: 'Automatically deny side-effecting operations.',
        },
      ],
    },
  ];
}

function buildConfigOptions(state: AcpSessionRuntimeState): SessionConfigOption[] {
  return buildConfigOptionsFromPolicy(state.permissionPolicy);
}

function buildConfigOptionUpdateIfChanged(state: AcpSessionRuntimeState): SessionUpdate | null {
  const configOptions = buildConfigOptions(state);
  const digest = JSON.stringify(configOptions);
  if (digest === state.lastConfigDigest) return null;
  state.lastConfigDigest = digest;
  return {
    sessionUpdate: 'config_option_update',
    configOptions,
  };
}

function applyPhaseToPlanState(event: LoopEvent, state: AcpSessionRuntimeState): boolean {
  if (event.type !== 'phase.start' && event.type !== 'phase.end') return false;

  const phaseKey = event.phase;
  const existing = state.planEntries.get(phaseKey);

  if (event.type === 'phase.start') {
    for (const [key, entry] of state.planEntries.entries()) {
      if (key !== phaseKey && entry.status === 'in_progress') {
        state.planEntries.set(key, { ...entry, status: 'completed' });
      }
    }
    state.planEntries.set(phaseKey, {
      content: phaseKey,
      priority: existing?.priority ?? 'medium',
      status: 'in_progress',
    });
    return true;
  }

  state.planEntries.set(phaseKey, {
    content: phaseKey,
    priority: existing?.priority ?? 'medium',
    status: 'completed',
  });
  return true;
}

function buildPlanUpdateIfChanged(state: AcpSessionRuntimeState): SessionUpdate | null {
  const entries = Array.from(state.planEntries.values());
  const digest = JSON.stringify(entries);
  if (digest === state.lastPlanDigest) return null;
  state.lastPlanDigest = digest;
  return {
    sessionUpdate: 'plan',
    entries,
  };
}

function buildAvailableCommandsUpdateIfChanged(
  state: AcpSessionRuntimeState,
): SessionUpdate | null {
  const availableCommands: Array<{ name: string; description: string }> = [];
  const digest = JSON.stringify(availableCommands);
  if (digest === state.lastCommandsDigest) return null;
  state.lastCommandsDigest = digest;
  return {
    sessionUpdate: 'available_commands_update',
    availableCommands,
  };
}

function loopEventToSessionUpdates(
  event: LoopEvent,
  state: AcpSessionRuntimeState,
): SessionUpdate[] {
  const updates: SessionUpdate[] = [];
  const mapped = loopEventToSessionUpdate(event);
  if (mapped) updates.push(mapped);

  if (applyPhaseToPlanState(event, state)) {
    const planUpdate = buildPlanUpdateIfChanged(state);
    if (planUpdate) updates.push(planUpdate);
  }

  return updates;
}

async function awaitTerminalEvent(params: {
  taskId: string;
  eventBus?: {
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
    list: (taskId: string, options?: { afterId?: string | null; limit?: number }) => TaskEvent[];
  };
}): Promise<TaskEvent | null> {
  if (!params.eventBus) return null;
  const history = params.eventBus.list(params.taskId);
  const terminal = history.find(isTerminalTaskEvent);
  if (terminal) return terminal;

  return await new Promise((resolve) => {
    const unsubscribe = params.eventBus!.subscribe((event) => {
      if (event.taskId !== params.taskId) return;
      if (!isTerminalTaskEvent(event)) return;
      unsubscribe();
      resolve(event);
    });
  });
}

export function createAcpFormalAgent(deps: {
  conn: AgentSideConnection;
  agentInfo: { name: string; version: string };
  facade: Facade;
  eventBus?: {
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
    list: (taskId: string, options?: { afterId?: string | null; limit?: number }) => TaskEvent[];
  };
}): Agent {
  const sessions = createAcpSessionStore();
  const sessionRuntime = new Map<string, AcpSessionRuntimeState>();
  let clientCapabilities: ClientCapabilities | undefined;
  const defaultClientCapabilities: ClientCapabilities = {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  };

  async function emitSessionUpdate(sessionId: string, update: SessionUpdate) {
    await deps.conn.sessionUpdate({ sessionId, update });
  }

  async function loadSessionInternal(params: LoadSessionRequest): Promise<AcpSessionRecord> {
    const session = sessions.get(params.sessionId);
    if (!session) {
      throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
    }
    if (session.cwd !== params.cwd) {
      sessions.update(params.sessionId, (current) => ({
        ...current,
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
      }));
    }
    return session;
  }

  function ensureSessionRuntimeState(sessionId: string): AcpSessionRuntimeState {
    const existing = sessionRuntime.get(sessionId);
    if (existing) return existing;
    const created = createSessionRuntimeState();
    sessionRuntime.set(sessionId, created);
    return created;
  }

  return {
    async initialize(params) {
      if (typeof params.protocolVersion !== 'number' || !Number.isFinite(params.protocolVersion)) {
        throw new RequestError(-32602, 'Invalid params: protocolVersion is required');
      }

      clientCapabilities = params.clientCapabilities;

      return {
        protocolVersion: PROTOCOL_VERSION,
        agentInfo: deps.agentInfo,
        authMethods: [],
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
          mcpCapabilities: { http: false, sse: false },
          sessionCapabilities: {},
        },
      };
    },

    async authenticate() {
      return;
    },

    async newSession(params) {
      if (!isAbsolutePath(params.cwd)) {
        throw new RequestError(-32602, 'Invalid params: cwd must be an absolute path');
      }
      const session = sessions.create({ cwd: params.cwd, mcpServers: params.mcpServers ?? [] });
      const runtimeState = ensureSessionRuntimeState(session.id);
      return { sessionId: session.id, configOptions: buildConfigOptions(runtimeState) };
    },

    async loadSession(params) {
      await loadSessionInternal(params);

      const session = sessions.get(params.sessionId)!;
      const runtimeState = ensureSessionRuntimeState(session.id);
      for (const entry of session.history) {
        const textParts = entry.content
          .map((block) =>
            block.type === 'text' && typeof block.text === 'string' ? block.text : '',
          )
          .filter(Boolean);
        if (textParts.length > 0) {
          const updateType = entry.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk';
          await emitSessionUpdate(session.id, {
            sessionUpdate: updateType,
            content: buildTextContentBlock(textParts.join('\n')),
          });
        }
      }

      return { sessionId: session.id, configOptions: buildConfigOptions(runtimeState) };
    },

    async setSessionConfigOption(params) {
      if (!sessions.get(params.sessionId)) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      if (params.configId !== ACP_PERMISSION_POLICY_CONFIG_ID) {
        throw new RequestError(-32602, `Invalid params: unsupported configId "${params.configId}"`);
      }
      if (!isPermissionPolicyValue(params.value)) {
        throw new RequestError(
          -32602,
          `Invalid params: unsupported value "${params.value}" for "${params.configId}"`,
        );
      }

      runtimeState.permissionPolicy = params.value;
      const update = buildConfigOptionUpdateIfChanged(runtimeState);
      if (update) {
        await emitSessionUpdate(params.sessionId, update);
      }

      return { configOptions: buildConfigOptions(runtimeState) };
    },

    async prompt(params) {
      const session = sessions.get(params.sessionId);
      if (!session) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      if ((clientCapabilities ?? defaultClientCapabilities).terminal !== true) {
        throw new RequestError(-32000, 'Client capability terminal is required');
      }

      const fsCaps = (clientCapabilities ?? defaultClientCapabilities).fs;
      if (!fsCaps?.readTextFile) {
        throw new RequestError(-32000, 'Client capability fs.readTextFile is required');
      }
      if (!fsCaps?.writeTextFile) {
        throw new RequestError(-32000, 'Client capability fs.writeTextFile is required');
      }

      const promptText = extractTextFromPrompt(params.prompt);
      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      sessions.update(params.sessionId, (current) => ({
        ...current,
        cancelRequested: false,
        history: [...current.history, { role: 'user', content: params.prompt as unknown as any[] }],
      }));

      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) {
        await emitSessionUpdate(params.sessionId, commandsUpdate);
      }

      const { task, signal } = await deps.facade.createTask({
        capability: 'patch',
        request: { instruction: promptText },
        commandRunner: createAcpCommandRunner({ conn: deps.conn, sessionId: params.sessionId }),
        fileSystemOverride: createAcpFileSystem({ conn: deps.conn, sessionId: params.sessionId }),
        authorizationProvider: createAcpToolAuthorizationProvider({
          conn: deps.conn,
          sessionId: params.sessionId,
          clientCapabilities: clientCapabilities ?? defaultClientCapabilities,
          getPermissionPolicy: () => runtimeState.permissionPolicy,
        }),
        authorizationMode: 'blocking',
        onEvent: (event: LoopEvent) => {
          for (const update of loopEventToSessionUpdates(event, runtimeState)) {
            void emitSessionUpdate(params.sessionId, update);
          }
        },
      });

      sessions.update(params.sessionId, (current) => ({ ...current, taskId: task.id }));

      if (signal.aborted) {
        await emitSessionUpdate(params.sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: buildTextContentBlock(ensureMarkdownParagraphBreak('Task cancelled.')),
        });
        return { stopReason: 'cancelled' };
      }

      const terminalEvent = await awaitTerminalEvent({ taskId: task.id, eventBus: deps.eventBus });
      let stopReason: StopReason = 'end_turn';
      let assistantText = 'Task completed.';

      if (terminalEvent?.type === 'task.failed') {
        assistantText = 'Task failed.';
      } else if (terminalEvent?.type === 'task.awaiting_input') {
        assistantText = 'Task awaiting input.';
      } else if (terminalEvent?.type === 'task.cancelled') {
        assistantText = 'Task cancelled.';
        stopReason = 'cancelled';
      }

      await emitSessionUpdate(params.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: buildTextContentBlock(ensureMarkdownParagraphBreak(assistantText)),
      });

      sessions.update(params.sessionId, (current) => ({
        ...current,
        history: [
          ...current.history,
          { role: 'assistant', content: [buildTextContentBlock(assistantText)] as any },
        ],
      }));

      return { stopReason };
    },

    async cancel(params) {
      const session = sessions.get(params.sessionId);
      if (!session) return;

      sessions.update(params.sessionId, (current) => ({ ...current, cancelRequested: true }));
      if (session.taskId) {
        await deps.facade.cancelTask(session.taskId);
      }
    },

    extMethod: async () => ({}),
    extNotification: async () => {},
  };
}
