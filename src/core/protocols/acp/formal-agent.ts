import { createHash } from 'crypto';

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
  type ToolCallContent,
  type ToolKind,
} from '@agentclientprotocol/sdk';

import { text } from '../../../locales/index.js';
import { mkdir, open, readFile, rename, unlink, writeFile } from '../../adapters/fs/node-fs.js';
import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import type { TaskEvent } from '../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../interaction/model/index.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { mapErrorForDisplay } from '../../observability/error-mapping.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import { parseSlashInput } from '../../slash/parser.js';
import type { FileSystem } from '../../types/index.js';
import type { LoopEvent } from '../../types/index.js';

import { createAcpCommandRunner } from './acp-command-runner.js';
import { createAcpFileSystem } from './acp-filesystem.js';
import type { AcpCheckpointMeta } from './checkpoint-meta.js';
import { createAcpSessionStore, isTerminalTaskEvent, type AcpSessionRecord } from './handlers.js';
import { createAcpToolAuthorizationProvider } from './permission-provider.js';

type Facade = {
  createTask: (input: {
    capability: string;
    request: { instruction: string; checkpointSessionId?: string };
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

function formatInputRequiredMessage(inputRequired: TaskEnvelope['inputRequired']): string | null {
  if (!inputRequired || !Array.isArray((inputRequired as any).questions)) return null;
  const questions = (inputRequired as any).questions as Array<{
    question: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  if (questions.length === 0) return null;

  const lines: string[] = [text.acp.askUserHeader];
  for (const q of questions) {
    lines.push(text.acp.askUserQuestion(q.question));
    lines.push(text.acp.askUserOptionsHeader);
    for (const option of q.options) {
      lines.push(text.acp.askUserOption(option.label, option.description));
    }
    if (q.multiSelect) {
      lines.push(text.acp.askUserMultiSelectHint);
    }
  }
  return lines.join('\n');
}

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
  lastSessionInfoDigest: string | null;
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
const ACP_SESSION_STORE_MAX_ENTRIES = 200;
const ACP_SESSION_STORE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const ACP_SESSION_STORE_LOCK_STALE_MS = 1000 * 30;

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

function buildJsonResourceContentBlock(data: unknown): ContentBlock {
  return {
    type: 'resource',
    resource: {
      mimeType: 'application/json',
      uri: 's8p://input-required',
      text: JSON.stringify(data),
    },
  } as ContentBlock;
}

const defaultPromptCapabilities = {
  image: false,
  audio: false,
  embeddedContext: false,
};

const ACP_AVAILABLE_COMMANDS: Array<{ name: string; description: string }> = [
  { name: 'help', description: text.acp.slashHelpDescription },
];

function formatResourceLink(block: Extract<ContentBlock, { type: 'resource_link' }>): string {
  const title = block.title ?? block.name ?? block.uri;
  const description = block.description ? ` - ${block.description}` : '';
  return `Resource: ${title} (${block.uri})${description}`;
}

function extractTextFromPrompt(
  prompt: ContentBlock[],
  capabilities: { image: boolean; audio: boolean; embeddedContext: boolean },
): string {
  const parts: string[] = [];
  for (const block of prompt) {
    switch (block.type) {
      case 'text':
        parts.push(block.text);
        break;
      case 'resource_link':
        parts.push(formatResourceLink(block));
        break;
      case 'image':
        if (!capabilities.image) {
          throw new RequestError(-32000, 'Prompt content type image is not supported');
        }
        break;
      case 'audio':
        if (!capabilities.audio) {
          throw new RequestError(-32000, 'Prompt content type audio is not supported');
        }
        break;
      case 'resource':
        if (!capabilities.embeddedContext) {
          throw new RequestError(-32000, 'Prompt content type resource is not supported');
        }
        break;
      default:
        throw new RequestError(-32602, 'Invalid params: unsupported content block type');
    }
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

function buildToolCallContent(textValue: string): ToolCallContent[] {
  return [{ type: 'content', content: buildTextContentBlock(textValue) }];
}

function formatToolCallStart(event: Extract<LoopEvent, { type: 'tool.call.start' }>): string {
  const input = event.input === undefined ? '' : `\nInput: ${JSON.stringify(event.input)}`;
  return `Tool call started: ${event.toolName}${input}`;
}

function formatToolCallEnd(event: Extract<LoopEvent, { type: 'tool.call.end' }>): string {
  if (event.outputSummary) return event.outputSummary;
  const status = event.status === 'ok' ? 'completed' : 'failed';
  return `Tool call ${status}: ${event.toolName}`;
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
        content: buildToolCallContent(formatToolCallStart(event)),
      };
    case 'tool.call.end':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.callId,
        status: event.status === 'ok' ? 'completed' : 'failed',
        content: buildToolCallContent(formatToolCallEnd(event)),
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
        const displayMessage = mapErrorForDisplay({
          message: event.message,
          code: event.code,
        }).message;
        return {
          sessionUpdate: 'agent_message_chunk',
          content: buildTextContentBlock(
            ensureMarkdownParagraphBreak(`[${event.level.toUpperCase()}] ${displayMessage}`),
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
    lastSessionInfoDigest: null,
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

function buildSessionInfoUpdateIfChanged(
  session: AcpSessionRecord,
  state: AcpSessionRuntimeState,
): SessionUpdate | null {
  const title = session.title ?? null;
  const updatedAt = session.updatedAt ?? null;
  const digest = JSON.stringify({ title, updatedAt });
  if (digest === state.lastSessionInfoDigest) return null;
  state.lastSessionInfoDigest = digest;
  return {
    sessionUpdate: 'session_info_update',
    title,
    updatedAt,
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
  const availableCommands = ACP_AVAILABLE_COMMANDS;
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

function extractSlashInput(prompt: ContentBlock[]): string | null {
  if (prompt.length !== 1) return null;
  const block = prompt[0];
  if (!block || block.type !== 'text') return null;
  const raw = block.text ?? '';
  if (!raw.trimStart().startsWith('/')) return null;
  return raw;
}

function buildSlashHelpMessage(): string {
  const names = ACP_AVAILABLE_COMMANDS.map((cmd) => `/${cmd.name}`).join(', ');
  return text.acp.slashHelpResponse(names);
}

function normalizeSlashName(commandName: string): string {
  return commandName.replace(/^\/+/, '').toLowerCase();
}

function isKnownSlashCommand(commandName: string): boolean {
  const normalized = normalizeSlashName(commandName);
  return ACP_AVAILABLE_COMMANDS.some((cmd) => cmd.name.toLowerCase() === normalized);
}

function buildSlashUnknownMessage(commandName: string): string {
  const normalized = normalizeSlashName(commandName);
  return text.acp.slashUnknownCommand(normalized);
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
  checkpointReader?: {
    listBySession: (input: { repoPath: string; sessionId: string; limit?: number }) => Promise<
      Array<{
        id: string;
        createdAt?: string;
        strategy?: string;
        backend?: string;
      }>
    >;
    getById?: (input: { repoPath: string; checkpointId: string }) => Promise<{
      id: string;
      createdAt?: string;
      strategy?: string;
      backend?: string;
    } | null>;
    probeById?: (input: {
      repoPath: string;
      checkpointId: string;
    }) => Promise<{ valid: boolean; reason: 'ok' | 'not_found' | 'manifest_unavailable' }>;
  };
  capabilityPolicy?: {
    loadSession?: boolean;
  };
  eventBus?: {
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
    list: (taskId: string, options?: { afterId?: string | null; limit?: number }) => TaskEvent[];
  };
  sessionPersistencePath?: string;
}): Agent {
  const sessions = createAcpSessionStore();
  const sessionRuntime = new Map<string, AcpSessionRuntimeState>();
  let clientCapabilities: ClientCapabilities | undefined;
  const defaultClientCapabilities: ClientCapabilities = {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  };
  const loadSessionCapability = deps.capabilityPolicy?.loadSession ?? true;
  const sessionPersistencePath = deps.sessionPersistencePath;
  let sessionsHydrated = false;
  let hydratePromise: Promise<void> | null = null;

  type PersistedAcpSessionStore = {
    schemaVersion: 1;
    sessions: Array<{
      id: string;
      cwd: string;
      mcpServers: unknown[];
      createdAt: string;
      updatedAt: string;
      title?: string;
    }>;
  };

  function parseTimestamp(value: unknown): number {
    if (typeof value !== 'string' || value.length === 0) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function pruneSessionRecords(
    records: Array<{
      id: string;
      cwd: string;
      mcpServers: unknown[];
      createdAt: string;
      updatedAt: string;
      title?: string;
    }>,
  ) {
    const cutoff = Date.now() - ACP_SESSION_STORE_MAX_AGE_MS;
    return [...records]
      .filter((record) => parseTimestamp(record.updatedAt) >= cutoff)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt))
      .slice(0, ACP_SESSION_STORE_MAX_ENTRIES);
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

  async function persistSessionsBestEffort(): Promise<void> {
    if (!sessionPersistencePath) return;
    const dir = defaultPathAdapter.dirname(sessionPersistencePath);
    const lockPath = `${sessionPersistencePath}.lock`;

    const baseRecords = sessions.list().map((session) => ({
      id: session.id,
      cwd: session.cwd,
      mcpServers: session.mcpServers,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      title: session.title,
    }));
    const prunedRecords = pruneSessionRecords(baseRecords);
    const keepIds = new Set(prunedRecords.map((record) => record.id));
    for (const record of sessions.list()) {
      if (!keepIds.has(record.id)) {
        sessions.delete(record.id);
      }
    }

    const payload: PersistedAcpSessionStore = { schemaVersion: 1, sessions: prunedRecords };

    const tryClearStaleLock = async (): Promise<void> => {
      try {
        const raw = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { createdAtMs?: number };
        const createdAtMs =
          typeof parsed.createdAtMs === 'number' && Number.isFinite(parsed.createdAtMs)
            ? parsed.createdAtMs
            : null;
        if (createdAtMs === null) return;
        if (Date.now() - createdAtMs <= ACP_SESSION_STORE_LOCK_STALE_MS) return;
        await unlink(lockPath);
      } catch {
        // ignore
      }
    };

    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(dir, { recursive: true });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          lockHandle = await open(lockPath, 'wx');
          await lockHandle.writeFile(
            JSON.stringify({ pid: process.pid, createdAtMs: Date.now() }),
            'utf8',
          );
          break;
        } catch {
          await tryClearStaleLock();
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
      if (!lockHandle) {
        throw new Error('ACP_SESSION_PERSIST_LOCK_TIMEOUT');
      }

      const tempPath = defaultPathAdapter.join(
        dir,
        `.sessions.v1.json.tmp-${process.pid}-${Date.now()}`,
      );
      await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      await rename(tempPath, sessionPersistencePath);
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

  async function hydrateSessionsOnce(): Promise<void> {
    if (sessionsHydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      sessionsHydrated = true;
      if (!sessionPersistencePath) return;
      try {
        const raw = await readFile(sessionPersistencePath, 'utf8');
        const parsed = JSON.parse(raw) as PersistedAcpSessionStore;
        if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions)) return;
        for (const stored of pruneSessionRecords(parsed.sessions)) {
          sessions.upsert({
            id: stored.id,
            cwd: stored.cwd,
            mcpServers: Array.isArray(stored.mcpServers) ? stored.mcpServers : [],
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            title: stored.title,
            history: [],
            cancelRequested: false,
          });
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

  function hashRepoPath(repoPath: string): string {
    return createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
  }

  function toCheckpointMeta(
    input:
      | {
          id: string;
          createdAt?: string;
          strategy?: string;
          backend?: string;
        }
      | undefined,
  ): AcpCheckpointMeta | null {
    if (!input) return null;
    return {
      id: input.id,
      createdAt: input.createdAt ?? null,
      strategy: input.strategy ?? null,
      backend: input.backend ?? null,
    };
  }

  async function emitSessionUpdate(sessionId: string, update: SessionUpdate) {
    await deps.conn.sessionUpdate({ sessionId, update });
  }

  async function loadSessionInternal(params: LoadSessionRequest): Promise<AcpSessionRecord> {
    await hydrateSessionsOnce();
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
      await persistSessionsBestEffort();
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
          loadSession: loadSessionCapability,
          promptCapabilities: defaultPromptCapabilities,
          mcpCapabilities: { http: false, sse: false },
          sessionCapabilities: {},
        },
      };
    },

    async authenticate() {
      return;
    },

    async newSession(params) {
      await hydrateSessionsOnce();
      if (!isAbsolutePath(params.cwd)) {
        throw new RequestError(-32602, 'Invalid params: cwd must be an absolute path');
      }
      const session = sessions.create({ cwd: params.cwd, mcpServers: params.mcpServers ?? [] });
      await persistSessionsBestEffort();
      const runtimeState = ensureSessionRuntimeState(session.id);
      let sessionMeta: Record<string, unknown> | undefined;
      if (deps.checkpointReader) {
        const checkpoints = await deps.checkpointReader.listBySession({
          repoPath: params.cwd,
          sessionId: session.id,
          limit: 1,
        });
        const latest = checkpoints.at(-1);
        sessionMeta = {
          salmonloop: {
            latestCheckpointId: latest?.id ?? null,
            checkpoint: toCheckpointMeta(latest),
          },
        };
      }
      return {
        sessionId: session.id,
        configOptions: buildConfigOptions(runtimeState),
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
    },

    async loadSession(params) {
      if (!loadSessionCapability) {
        throw new RequestError(-32601, '"Method not found": session/load');
      }
      await loadSessionInternal(params);

      const session = sessions.get(params.sessionId)!;
      const runtimeState = ensureSessionRuntimeState(session.id);
      const sessionInfoUpdate = buildSessionInfoUpdateIfChanged(session, runtimeState);
      if (sessionInfoUpdate) {
        await emitSessionUpdate(session.id, sessionInfoUpdate);
      }
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

      const response: {
        configOptions: SessionConfigOption[];
        _meta?: Record<string, unknown>;
      } = { configOptions: buildConfigOptions(runtimeState) };
      if (deps.checkpointReader) {
        const startedAt = Date.now();
        const checkpoints = await deps.checkpointReader.listBySession({
          repoPath: params.cwd,
          sessionId: params.sessionId,
          limit: 1,
        });
        const latest = checkpoints.at(-1);
        let resumeProbe: { checkpointId: string; valid: boolean; reason?: string } | null = null;
        if (latest?.id && deps.checkpointReader.probeById) {
          const probed = await deps.checkpointReader.probeById({
            repoPath: params.cwd,
            checkpointId: latest.id,
          });
          resumeProbe = {
            checkpointId: latest.id,
            valid: probed.valid,
            reason: probed.reason,
          };
        } else if (latest?.id && deps.checkpointReader.getById) {
          const found = await deps.checkpointReader.getById({
            repoPath: params.cwd,
            checkpointId: latest.id,
          });
          resumeProbe = {
            checkpointId: latest.id,
            valid: Boolean(found),
            reason: found ? 'ok' : 'not_found',
          };
        }
        const resumeReady = resumeProbe?.valid ?? Boolean(latest);
        recordAuditEvent(
          'acp.checkpoint.read',
          {
            sessionId: params.sessionId,
            repoPathHash: hashRepoPath(params.cwd),
            latestCheckpointId: latest?.id ?? null,
            hit: Boolean(latest),
            latencyMs: Date.now() - startedAt,
            resumeProbe: resumeProbe ?? undefined,
          },
          { source: 'acp', severity: 'low', scope: 'session', phase: 'PREFLIGHT' },
        );
        response._meta = {
          salmonloop: {
            latestCheckpointId: latest?.id ?? null,
            checkpoint: toCheckpointMeta(latest),
            resumeReady,
            resumeProbe,
          },
        };
      }

      return response;
    },

    async setSessionConfigOption(params) {
      await hydrateSessionsOnce();
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
      const updatedSession =
        sessions.update(params.sessionId, (current) => ({ ...current })) ??
        sessions.get(params.sessionId)!;
      await persistSessionsBestEffort();
      const update = buildConfigOptionUpdateIfChanged(runtimeState);
      if (update) {
        await emitSessionUpdate(params.sessionId, update);
      }
      const sessionInfoUpdate = buildSessionInfoUpdateIfChanged(updatedSession, runtimeState);
      if (sessionInfoUpdate) {
        await emitSessionUpdate(params.sessionId, sessionInfoUpdate);
      }

      return { configOptions: buildConfigOptions(runtimeState) };
    },

    async prompt(params) {
      await hydrateSessionsOnce();
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

      const promptText = extractTextFromPrompt(params.prompt, defaultPromptCapabilities);
      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      const sessionAfterUserMessage =
        sessions.update(params.sessionId, (current) => ({
          ...current,
          cancelRequested: false,
          history: [
            ...current.history,
            { role: 'user', content: params.prompt as unknown as any[] },
          ],
        })) ?? sessions.get(params.sessionId)!;
      await persistSessionsBestEffort();
      const sessionInfoUpdate = buildSessionInfoUpdateIfChanged(
        sessionAfterUserMessage,
        runtimeState,
      );
      if (sessionInfoUpdate) {
        await emitSessionUpdate(params.sessionId, sessionInfoUpdate);
      }

      await emitSessionUpdate(params.sessionId, {
        sessionUpdate: 'user_message_chunk',
        content: buildTextContentBlock(promptText),
      });

      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) {
        await emitSessionUpdate(params.sessionId, commandsUpdate);
      }

      const slashInput = extractSlashInput(params.prompt);
      if (slashInput) {
        const parsed = parseSlashInput(slashInput);
        if (parsed.kind === 'slash' && parsed.commandName) {
          const responseText = isKnownSlashCommand(parsed.commandName)
            ? buildSlashHelpMessage()
            : buildSlashUnknownMessage(parsed.commandName);
          await emitSessionUpdate(params.sessionId, {
            sessionUpdate: 'agent_message_chunk',
            content: buildTextContentBlock(ensureMarkdownParagraphBreak(responseText)),
          });
          const sessionAfterAssistantMessage =
            sessions.update(params.sessionId, (current) => ({
              ...current,
              history: [
                ...current.history,
                { role: 'assistant', content: [buildTextContentBlock(responseText)] as any },
              ],
            })) ?? sessions.get(params.sessionId)!;
          await persistSessionsBestEffort();
          const finalSessionInfoUpdate = buildSessionInfoUpdateIfChanged(
            sessionAfterAssistantMessage,
            runtimeState,
          );
          if (finalSessionInfoUpdate) {
            await emitSessionUpdate(params.sessionId, finalSessionInfoUpdate);
          }
          return { stopReason: 'end_turn' };
        }
      }

      const { task, signal } = await deps.facade.createTask({
        capability: 'patch',
        request: { instruction: promptText, checkpointSessionId: params.sessionId },
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
      await persistSessionsBestEffort();

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
      let assistantMeta: Record<string, unknown> | undefined;
      let latest: TaskEnvelope | null | undefined;
      const cancelRequested = sessions.get(params.sessionId)?.cancelRequested === true;

      if (cancelRequested) {
        assistantText = 'Task cancelled.';
        stopReason = 'cancelled';
      } else if (terminalEvent?.type === 'task.failed') {
        latest = await deps.facade.getTask(task.id);
        const failureMessage =
          typeof latest?.failure?.message === 'string' ? latest.failure.message : undefined;
        assistantText = failureMessage ? `Task failed: ${failureMessage}` : 'Task failed.';
      } else if (terminalEvent?.type === 'task.awaiting_input') {
        assistantText = 'Task awaiting input.';
        latest = await deps.facade.getTask(task.id);
        const formatted = latest?.inputRequired
          ? formatInputRequiredMessage(latest.inputRequired)
          : null;
        if (formatted) assistantText = formatted;
        if (latest?.inputRequired) {
          assistantMeta = { inputRequired: latest.inputRequired };
        }
      } else if (terminalEvent?.type === 'task.cancelled') {
        assistantText = 'Task cancelled.';
        stopReason = 'cancelled';
      }

      await emitSessionUpdate(params.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: buildTextContentBlock(ensureMarkdownParagraphBreak(assistantText)),
        ...(assistantMeta ? { _meta: assistantMeta } : {}),
      });
      if (latest?.inputRequired) {
        await emitSessionUpdate(params.sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: buildJsonResourceContentBlock(latest.inputRequired),
        });
      }

      const sessionAfterAssistantMessage =
        sessions.update(params.sessionId, (current) => ({
          ...current,
          history: [
            ...current.history,
            { role: 'assistant', content: [buildTextContentBlock(assistantText)] as any },
          ],
        })) ?? sessions.get(params.sessionId)!;
      await persistSessionsBestEffort();
      const finalSessionInfoUpdate = buildSessionInfoUpdateIfChanged(
        sessionAfterAssistantMessage,
        runtimeState,
      );
      if (finalSessionInfoUpdate) {
        await emitSessionUpdate(params.sessionId, finalSessionInfoUpdate);
      }

      return { stopReason };
    },

    async cancel(params) {
      await hydrateSessionsOnce();
      const session = sessions.get(params.sessionId);
      if (!session) return;

      sessions.update(params.sessionId, (current) => ({ ...current, cancelRequested: true }));
      await persistSessionsBestEffort();
      if (session.taskId) {
        await deps.facade.cancelTask(session.taskId);
      }
    },

    extMethod: async () => ({}),
    extNotification: async () => {},
  };
}
