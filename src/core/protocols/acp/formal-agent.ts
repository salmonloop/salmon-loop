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
  type SessionModeState,
  type SessionUpdate,
  type StopReason,
  type ToolCallContent,
  type ToolKind,
} from '@agentclientprotocol/sdk';

import { text } from '../../../locales/index.js';
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
import type { TaskEvent } from '../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../interaction/model/index.js';
import { inferTurnStopReasonFromFailure } from '../../interaction/turn-stop-reason.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { readPlan } from '../../plan/index.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import { parseSlashInput } from '../../slash/parser.js';
import type { FileSystem } from '../../types/index.js';
import type { LoopEvent } from '../../types/index.js';
import { buildCanonicalExecutionRequest } from '../shared/execution-request.js';

import { createAcpCommandRunner } from './acp-command-runner.js';
import { createAcpFileSystem } from './acp-filesystem.js';
import type { AcpCheckpointMeta } from './checkpoint-meta.js';
import { createAcpSessionStore, isTerminalTaskEvent, type AcpSessionRecord } from './handlers.js';
import { createAcpToolAuthorizationProvider } from './permission-provider.js';

type Facade = {
  createTask: (input: {
    capability: string;
    request: { instruction: string; checkpointSessionId?: string; repoPath?: string };
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

type AcpPermissionPolicy = 'ask' | 'deny_all';
type AcpSessionModeId = 'interactive' | 'yolo';

type AcpPlanEntry = {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
};

type CorePlanStepSummary = {
  stepId: string;
  text: string;
};

type CorePlanReadResult = {
  sessionId: string;
  baseHash: string;
  active: CorePlanStepSummary[];
  pending: CorePlanStepSummary[];
  recentDone: CorePlanStepSummary[];
};

type AcpSessionRuntimeState = {
  runtimePlanSessionId: string | null;
  runtimePlanPathHint: string | null;
  lastPlanDigest: string | null;
  lastCommandsDigest: string | null;
  lastConfigDigest: string | null;
  lastModeDigest: string | null;
  lastSessionInfoDigest: string | null;
  permissionPolicy: AcpPermissionPolicy;
  modeId: AcpSessionModeId;
};

const ACP_PERMISSION_POLICY_CONFIG_ID = '_salmonloop_permission_policy';
const ACP_MODE_CONFIG_ID = '_salmonloop_mode';
const ACP_PERMISSION_POLICY_ASK: AcpPermissionPolicy = 'ask';
const ACP_PERMISSION_POLICY_DENY_ALL: AcpPermissionPolicy = 'deny_all';
const ACP_DEFAULT_MODE_ID: AcpSessionModeId = 'interactive';
const ACP_SESSION_STORE_MAX_ENTRIES = 200;
const ACP_SESSION_STORE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const ACP_SESSION_STORE_LOCK_STALE_MS = 1000 * 30;
const ACP_SESSION_STORE_LOCK_HEARTBEAT_MS = 1000 * 5;
const ACP_SESSION_STORE_LOCK_ACQUIRE_TIMEOUT_MS = 1000 * 5;
const ACP_SESSION_HISTORY_MAX_ENTRIES = 40;

function isAbsolutePath(filePath: string): boolean {
  if (defaultPathAdapter.isAbsolute(filePath)) return true;
  // Cross-platform absolute check for Windows paths on non-Windows runtimes.
  // ACP requires absolute paths, but the runtime OS may not match the client OS.
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) return true; // drive letter
  if (filePath.startsWith('\\\\')) return true; // UNC path
  return false;
}

function deriveSessionTitleFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  if (!trimmed) return cwd;
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  const basename = segments.at(-1);
  if (basename && basename.trim()) return basename;
  return trimmed;
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

function mapToolKind(toolName: string, intent?: string): ToolKind {
  if (intent) {
    switch (intent.toUpperCase()) {
      case 'READ':
        return 'read';
      case 'LIST':
        return 'read';
      case 'SEARCH':
        return 'search';
      case 'WRITE':
        return 'edit';
      case 'INFRA':
        return 'execute';
      case 'AGENT':
        return 'think';
    }
  }

  const name = toolName.toLowerCase();
  if (
    name.includes('read') ||
    name.includes('get') ||
    name.includes('view') ||
    name.includes('ls') ||
    name.includes('list')
  )
    return 'read';
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'edit';
  if (name.includes('delete') || name.includes('remove') || name.includes('rm')) return 'delete';
  if (name.includes('move') || name.includes('rename') || name.includes('mv')) return 'move';
  if (name.includes('grep') || name.includes('search') || name.includes('find')) return 'search';
  if (name.includes('run') || name.includes('exec') || name.includes('spawn')) return 'execute';
  if (name.includes('plan') || name.includes('think') || name.includes('reason')) return 'think';
  if (name.includes('fetch') || name.includes('curl') || name.includes('http')) return 'fetch';
  return 'other';
}

function buildToolCallContent(textValue: string): ToolCallContent[] {
  return [{ type: 'content', content: buildTextContentBlock(textValue) }];
}

function extractLocationFromInput(input: unknown): { path: string; line?: number }[] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const typedInput = input as Record<string, unknown>;
  const pathCandidate = typedInput.path ?? typedInput.file ?? typedInput.uri;
  if (typeof pathCandidate === 'string' && pathCandidate.trim()) {
    let path = pathCandidate.replace(/^file:\/\/\//, '/').replace(/^file:\/\//, '');
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1);
    }
    return [
      {
        path,
        line: typeof typedInput.line === 'number' ? typedInput.line : undefined,
      },
    ];
  }
  return undefined;
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
        sessionUpdate:
          event.kind === 'assistant_message' ? 'agent_message_chunk' : 'agent_thought_chunk',
        content: buildTextContentBlock(event.content || ''),
      };
    case 'llm.output':
      return {
        sessionUpdate:
          event.kind === 'assistant_message' ? 'agent_message_chunk' : 'agent_thought_chunk',
        content: buildTextContentBlock(event.content || ''),
      };
    case 'tool.call.start':
      return {
        sessionUpdate: 'tool_call',
        toolCallId: event.callId,
        status: 'pending',
        title: event.toolName,
        kind: mapToolKind(event.toolName, event.toolIntent),
        content: [],
        rawInput: event.input as any,
        locations: extractLocationFromInput(event.input),
      };
    case 'tool.call.end':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.callId,
        status: event.status === 'ok' ? 'completed' : 'failed',
        content: event.status !== 'ok' ? buildToolCallContent(formatToolCallEnd(event)) : [],
        rawOutput: event.outputSummary as any,
      };
    case 'phase.start':
      return null;
    case 'phase.end':
      return null;
    case 'log':
      return null;
    default:
      return null;
  }
}

function createSessionRuntimeState(): AcpSessionRuntimeState {
  return createSessionRuntimeStateFromPersisted();
}

function isPermissionPolicyValue(value: string): value is AcpPermissionPolicy {
  return value === ACP_PERMISSION_POLICY_ASK || value === ACP_PERMISSION_POLICY_DENY_ALL;
}

function buildConfigOptions(state: AcpSessionRuntimeState): SessionConfigOption[] {
  return [
    {
      type: 'select',
      id: ACP_PERMISSION_POLICY_CONFIG_ID,
      name: text.acp.permissionPolicyName,
      description: text.acp.permissionPolicyDescription,
      currentValue: state.permissionPolicy,
      options: [
        {
          value: ACP_PERMISSION_POLICY_ASK,
          name: text.acp.permissionPolicyAskName,
          description: text.acp.permissionPolicyAskDescription,
        },
        {
          value: ACP_PERMISSION_POLICY_DENY_ALL,
          name: text.acp.permissionPolicyDenyAllName,
          description: text.acp.permissionPolicyDenyAllDescription,
        },
      ],
    },
    {
      type: 'select',
      id: ACP_MODE_CONFIG_ID,
      name: 'Session Mode',
      description: text.acp.modeInteractiveDescription,
      currentValue: state.modeId,
      options: [
        {
          value: 'interactive',
          name: 'Interactive',
          description: text.acp.modeInteractiveDescription,
        },
        {
          value: 'yolo',
          name: 'YOLO',
          description: text.acp.modeYoloDescription,
        },
      ],
    },
  ];
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

function buildSessionInfoUpdateIfChanged(
  session: Pick<AcpSessionRecord, 'title' | 'updatedAt'>,
  state: AcpSessionRuntimeState,
): SessionUpdate | null {
  const title = typeof session.title === 'string' ? session.title : null;
  const updatedAt = typeof session.updatedAt === 'string' ? session.updatedAt : null;
  const digest = JSON.stringify({ title, updatedAt });
  if (digest === state.lastSessionInfoDigest) return null;
  state.lastSessionInfoDigest = digest;
  return {
    sessionUpdate: 'session_info_update',
    title,
    updatedAt,
  };
}

function isSessionModeId(value: string): value is AcpSessionModeId {
  return value === 'interactive' || value === 'yolo';
}

function buildCurrentModeUpdate(modeId: AcpSessionModeId): SessionUpdate {
  return { sessionUpdate: 'current_mode_update', currentModeId: modeId };
}

function buildModesState(modeId: AcpSessionModeId): SessionModeState {
  return {
    currentModeId: modeId,
    availableModes: [
      {
        id: 'interactive',
        name: 'Interactive',
        description: text.acp.modeInteractiveDescription,
      },
      {
        id: 'yolo',
        name: 'YOLO',
        description: text.acp.modeYoloDescription,
      },
    ],
  };
}

function buildCurrentModeUpdateIfChanged(state: AcpSessionRuntimeState): SessionUpdate | null {
  const digest = state.modeId;
  if (digest === state.lastModeDigest) return null;
  state.lastModeDigest = digest;
  return buildCurrentModeUpdate(state.modeId);
}

function getPermissionPolicyForAuthorization(
  state: AcpSessionRuntimeState,
): 'ask' | 'deny_all' | 'allow_all' {
  if (state.modeId === 'yolo') return 'allow_all';
  return state.permissionPolicy;
}

function createSessionRuntimeStateFromPersisted(input?: {
  permissionPolicy?: unknown;
  modeId?: unknown;
  defaultModeId?: AcpSessionModeId;
}): AcpSessionRuntimeState {
  const permissionPolicy = isPermissionPolicyValue(String(input?.permissionPolicy))
    ? (input?.permissionPolicy as AcpPermissionPolicy)
    : ACP_PERMISSION_POLICY_ASK;
  const modeId = isSessionModeId(String(input?.modeId))
    ? (input?.modeId as AcpSessionModeId)
    : (input?.defaultModeId ?? ACP_DEFAULT_MODE_ID);
  const state: AcpSessionRuntimeState = {
    runtimePlanSessionId: null,
    runtimePlanPathHint: null,
    lastPlanDigest: null,
    lastCommandsDigest: null,
    lastConfigDigest: null,
    lastModeDigest: null,
    lastSessionInfoDigest: null,
    permissionPolicy,
    modeId,
  };
  state.lastConfigDigest = JSON.stringify(buildConfigOptions(state));
  return state;
}

function loopEventToSessionUpdates(
  event: LoopEvent,
  _state: AcpSessionRuntimeState,
): SessionUpdate[] {
  const updates: SessionUpdate[] = [];
  const mapped = loopEventToSessionUpdate(event);
  if (mapped) updates.push(mapped);

  return updates;
}

function shouldRefreshPlanForEvent(event?: LoopEvent): boolean {
  if (!event) return true;
  if (event.type === 'plan.runtime.ready') return true;
  if (
    event.type === 'tool.call.end' &&
    (event.toolName === 'plan.init' || event.toolName === 'plan.update') &&
    event.status === 'ok'
  ) {
    return true;
  }
  if (
    event.type === 'plan.runtime.journal' &&
    event.phase === 'PLAN' &&
    event.kind === 'end' &&
    event.ok
  ) {
    return true;
  }
  return false;
}

function mapCorePlanToAcpEntries(read: CorePlanReadResult): AcpPlanEntry[] {
  const entries: AcpPlanEntry[] = [];
  const seen = new Set<string>();

  const parsePriority = (text: string): { priority: AcpPlanEntry['priority']; content: string } => {
    const trimmed = text.trim();
    if (trimmed.startsWith('!')) {
      return { priority: 'high', content: trimmed.slice(1).trim() };
    }
    if (trimmed.startsWith('·')) {
      return { priority: 'medium', content: trimmed.slice(1).trim() };
    }
    if (trimmed.startsWith('‐')) {
      return { priority: 'low', content: trimmed.slice(1).trim() };
    }
    return { priority: 'medium', content: trimmed };
  };

  const push = (step: CorePlanStepSummary, status: AcpPlanEntry['status']) => {
    if (!step?.stepId || seen.has(step.stepId)) return;
    seen.add(step.stepId);
    const { priority, content } = parsePriority(step.text || step.stepId);
    entries.push({
      content,
      status,
      priority,
    });
  };

  for (const step of read.active) push(step, 'in_progress');
  for (const step of read.pending) push(step, 'pending');
  for (const step of read.recentDone) push(step, 'completed');
  return entries;
}

function buildPlanUpdateFromCoreIfChanged(
  read: CorePlanReadResult,
  state: AcpSessionRuntimeState,
): SessionUpdate | null {
  const entries = mapCorePlanToAcpEntries(read);
  const digest = JSON.stringify({
    sessionId: read.sessionId,
    baseHash: read.baseHash,
    entries,
  });
  if (digest === state.lastPlanDigest) return null;
  state.lastPlanDigest = digest;
  return {
    sessionUpdate: 'plan',
    entries,
  };
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
  defaultModeId?: AcpSessionModeId;
  planReader?: {
    readBySession: (input: { repoPath: string; sessionId: string }) => Promise<CorePlanReadResult>;
  };
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
    probeById?: (input: { repoPath: string; checkpointId: string }) => Promise<{
      valid: boolean;
      reason:
        | 'ok'
        | 'not_found'
        | 'manifest_unavailable'
        | 'manifest_parse_error'
        | 'manifest_io_error'
        | 'manifest_lock_timeout';
    }>;
  };
  capabilityPolicy?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    mcpCapabilities?: {
      http?: boolean;
      sse?: boolean;
    };
  };
  eventBus?: {
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
    list: (taskId: string, options?: { afterId?: string | null; limit?: number }) => TaskEvent[];
  };
  sessionPersistencePath?: string;
  sessionStorePolicy?: {
    maxEntries?: number;
    maxAgeMs?: number;
    historyMaxEntries?: number;
    lockStaleMs?: number;
    lockHeartbeatMs?: number;
    lockAcquireTimeoutMs?: number;
  };
  executionBinding?: 'local' | 'client';
}): Agent {
  const sessions = createAcpSessionStore();
  const sessionRuntime = new Map<string, AcpSessionRuntimeState>();
  let clientCapabilities: ClientCapabilities | undefined;
  const defaultClientCapabilities: ClientCapabilities = {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  };
  const loadSessionCapability = deps.capabilityPolicy?.loadSession ?? true;
  const promptCapabilities = {
    image: deps.capabilityPolicy?.promptCapabilities?.image ?? false,
    audio: deps.capabilityPolicy?.promptCapabilities?.audio ?? false,
    embeddedContext: deps.capabilityPolicy?.promptCapabilities?.embeddedContext ?? false,
  };
  const mcpCapabilities = {
    http: deps.capabilityPolicy?.mcpCapabilities?.http ?? false,
    sse: deps.capabilityPolicy?.mcpCapabilities?.sse ?? false,
  };
  const sessionPersistencePath = deps.sessionPersistencePath;
  const sessionStorePolicy = {
    maxEntries: deps.sessionStorePolicy?.maxEntries ?? ACP_SESSION_STORE_MAX_ENTRIES,
    maxAgeMs: deps.sessionStorePolicy?.maxAgeMs ?? ACP_SESSION_STORE_MAX_AGE_MS,
    historyMaxEntries:
      deps.sessionStorePolicy?.historyMaxEntries ?? ACP_SESSION_HISTORY_MAX_ENTRIES,
    lockStaleMs: deps.sessionStorePolicy?.lockStaleMs ?? ACP_SESSION_STORE_LOCK_STALE_MS,
    lockHeartbeatMs:
      deps.sessionStorePolicy?.lockHeartbeatMs ?? ACP_SESSION_STORE_LOCK_HEARTBEAT_MS,
    lockAcquireTimeoutMs:
      deps.sessionStorePolicy?.lockAcquireTimeoutMs ?? ACP_SESSION_STORE_LOCK_ACQUIRE_TIMEOUT_MS,
  };
  const executionBinding = deps.executionBinding ?? 'local';
  let sessionsHydrated = false;
  let hydratePromise: Promise<void> | null = null;

  type PersistedAcpSessionStoreV1 = {
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

  type PersistedAcpSessionStoreV2 = {
    schemaVersion: 2;
    sessions: Array<{
      id: string;
      cwd: string;
      mcpServers: unknown[];
      createdAt: string;
      updatedAt: string;
      title?: string;
      taskId?: string;
      history?: AcpSessionRecord['history'];
      permissionPolicy?: AcpPermissionPolicy;
      modeId?: AcpSessionModeId;
    }>;
  };
  type PersistedAcpSessionStore = PersistedAcpSessionStoreV1 | PersistedAcpSessionStoreV2;

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
      taskId?: string;
      history?: AcpSessionRecord['history'];
      permissionPolicy?: AcpPermissionPolicy;
      modeId?: AcpSessionModeId;
    }>,
  ) {
    const cutoff = Date.now() - sessionStorePolicy.maxAgeMs;
    return [...records]
      .filter((record) => parseTimestamp(record.updatedAt) >= cutoff)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt))
      .slice(0, sessionStorePolicy.maxEntries);
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
          permissionPolicy: ACP_PERMISSION_POLICY_ASK,
          modeId: deps.defaultModeId ?? ACP_DEFAULT_MODE_ID,
        })),
      };
    }
    if (raw.schemaVersion === 2) {
      return { schemaVersion: 2, sessions: raw.sessions as PersistedAcpSessionStoreV2['sessions'] };
    }
    return { schemaVersion: 2, sessions: [] };
  }

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

  async function persistSessionsBestEffort(): Promise<void> {
    if (!sessionPersistencePath) return;
    const dir = defaultPathAdapter.dirname(sessionPersistencePath);
    const lockPath = `${sessionPersistencePath}.lock`;

    const baseRecords = sessions.list().map((session) => {
      const runtimeState = ensureSessionRuntimeState(session.id);
      return {
        id: session.id,
        cwd: session.cwd,
        mcpServers: session.mcpServers,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        title: session.title,
        taskId: session.taskId,
        history: session.history.slice(-sessionStorePolicy.historyMaxEntries),
        permissionPolicy: runtimeState.permissionPolicy,
        modeId: runtimeState.modeId,
      };
    });
    const prunedRecords = pruneSessionRecords(baseRecords);
    const keepIds = new Set(prunedRecords.map((record) => record.id));
    for (const record of sessions.list()) {
      if (!keepIds.has(record.id)) {
        sessions.delete(record.id);
      }
    }

    const payload: PersistedAcpSessionStoreV2 = { schemaVersion: 2, sessions: prunedRecords };
    const primaryRepoPath = prunedRecords[0]?.cwd;
    const lockAuditDetails = {
      lockPath,
      lockPathHash: createHash('sha256').update(lockPath).digest('hex').slice(0, 16),
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
        if (Date.now() - createdAtMs <= sessionStorePolicy.lockStaleMs) return;
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
          if (Number.isFinite(ageMs) && ageMs > sessionStorePolicy.lockStaleMs * 2) {
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
      const acquireDeadlineMs = Date.now() + Math.max(250, sessionStorePolicy.lockAcquireTimeoutMs);
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
        Math.max(1000, sessionStorePolicy.lockHeartbeatMs),
      );
      const tempPath = defaultPathAdapter.join(
        dir,
        `.sessions.v1.json.tmp-${process.pid}-${Date.now()}`,
      );
      try {
        let existing: PersistedAcpSessionStoreV2 = { schemaVersion: 2, sessions: [] };
        try {
          const existingRaw = await readFile(sessionPersistencePath, 'utf8');
          existing = normalizePersistedSessionStore(JSON.parse(existingRaw));
        } catch {
          // ignore read failure; writing fresh payload is acceptable
        }

        const merged = new Map<string, PersistedAcpSessionStoreV2['sessions'][number]>();
        for (const entry of existing.sessions) merged.set(entry.id, entry);
        for (const entry of payload.sessions) merged.set(entry.id, entry);
        const mergedPayload: PersistedAcpSessionStoreV2 = {
          schemaVersion: 2,
          sessions: pruneSessionRecords(Array.from(merged.values())),
        };

        await writeFile(tempPath, JSON.stringify(mergedPayload, null, 2), 'utf8');
        await rename(tempPath, sessionPersistencePath);
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

  async function hydrateSessionsOnce(): Promise<void> {
    if (sessionsHydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      sessionsHydrated = true;
      if (!sessionPersistencePath) return;
      try {
        const raw = await readFile(sessionPersistencePath, 'utf8');
        const parsed = normalizePersistedSessionStore(JSON.parse(raw));
        for (const stored of pruneSessionRecords(parsed.sessions)) {
          sessions.upsert({
            id: stored.id,
            cwd: stored.cwd,
            mcpServers: Array.isArray(stored.mcpServers) ? stored.mcpServers : [],
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            title: stored.title,
            taskId: stored.taskId,
            history: Array.isArray(stored.history)
              ? stored.history.slice(-sessionStorePolicy.historyMaxEntries)
              : [],
            cancelRequested: false,
          });
          if (!sessionRuntime.has(stored.id)) {
            sessionRuntime.set(
              stored.id,
              createSessionRuntimeStateFromPersisted({
                permissionPolicy: stored.permissionPolicy,
                modeId: stored.modeId,
                defaultModeId: deps.defaultModeId,
              }),
            );
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

  function toResumeHint(
    probe: {
      checkpointId: string;
      valid: boolean;
      reason?: string;
    } | null,
  ): { code: string; message: string } | null {
    if (!probe || probe.valid) return null;
    switch (probe.reason) {
      case 'not_found':
        return {
          code: 'CHECKPOINT_NOT_FOUND',
          message: 'Checkpoint not found. Start a new session.',
        };
      case 'manifest_parse_error':
        return {
          code: 'CHECKPOINT_MANIFEST_PARSE_ERROR',
          message: 'Checkpoint metadata is corrupted. Recreate checkpoint metadata and retry.',
        };
      case 'manifest_io_error':
        return {
          code: 'CHECKPOINT_MANIFEST_IO_ERROR',
          message: 'Checkpoint metadata is unreadable due to filesystem I/O issues.',
        };
      case 'manifest_lock_timeout':
        return {
          code: 'CHECKPOINT_MANIFEST_LOCK_TIMEOUT',
          message: 'Checkpoint metadata is busy (lock timeout). Retry shortly.',
        };
      case 'manifest_unavailable':
        return {
          code: 'CHECKPOINT_MANIFEST_UNAVAILABLE',
          message: 'Checkpoint metadata is unavailable in current runtime.',
        };
      default:
        return {
          code: 'CHECKPOINT_RESUME_UNAVAILABLE',
          message: 'Checkpoint resume is unavailable. Start a new session or retry.',
        };
    }
  }

  async function emitSessionUpdate(sessionId: string, update: SessionUpdate) {
    await deps.conn.sessionUpdate({ sessionId, update });
  }

  async function emitSessionInfoUpdateBestEffort(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) return;
    const state = ensureSessionRuntimeState(sessionId);
    const update = buildSessionInfoUpdateIfChanged(session, state);
    if (!update) return;
    try {
      await emitSessionUpdate(sessionId, update);
    } catch {
      // Best-effort: do not fail the request due to notification delivery issues.
    }
  }

  async function emitRuntimePlanUpdateIfNeeded(params: {
    sessionId: string;
    repoPath: string;
    event?: LoopEvent;
    state: AcpSessionRuntimeState;
  }): Promise<void> {
    if (!shouldRefreshPlanForEvent(params.event)) return;
    const { state, event } = params;
    const planReader = deps.planReader ?? {
      readBySession: async ({ repoPath, sessionId }: { repoPath: string; sessionId: string }) =>
        await readPlan({ persistenceRoot: repoPath, sessionId }),
    };

    if (event?.type === 'plan.runtime.ready') {
      state.runtimePlanSessionId = event.sessionId;
      state.runtimePlanPathHint = event.planPathHint;
      state.lastPlanDigest = null;
    }

    if (!state.runtimePlanSessionId) return;

    try {
      const read = await planReader.readBySession({
        repoPath: params.repoPath,
        sessionId: state.runtimePlanSessionId,
      });
      const planUpdate = buildPlanUpdateFromCoreIfChanged(read, state);
      if (planUpdate) {
        await emitSessionUpdate(params.sessionId, planUpdate);
      }
    } catch (error) {
      recordAuditEvent(
        'acp.plan.read.failed',
        {
          sessionId: params.sessionId,
          repoPathHash: hashRepoPath(params.repoPath),
          runtimePlanSessionId: state.runtimePlanSessionId,
          runtimePlanPathHint: state.runtimePlanPathHint,
          errorName: error instanceof Error ? error.name : typeof error,
        },
        { source: 'acp', severity: 'low', scope: 'session', phase: 'PLAN' },
      );
    }
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
    if (deps.defaultModeId) {
      created.modeId = deps.defaultModeId;
    }
    sessionRuntime.set(sessionId, created);
    return created;
  }

  return {
    async initialize(params) {
      if (typeof params.protocolVersion !== 'number' || !Number.isFinite(params.protocolVersion)) {
        throw new RequestError(-32602, 'Invalid params: protocolVersion is required');
      }

      clientCapabilities = params.clientCapabilities;

      // Protocol version negotiation:
      // - If the client's requested version is supported, return the same version
      // - Otherwise, return the latest version the agent supports
      // Currently, the agent only supports protocol version 1
      const supportedProtocolVersion = PROTOCOL_VERSION;
      const negotiatedVersion =
        params.protocolVersion <= supportedProtocolVersion
          ? params.protocolVersion
          : supportedProtocolVersion;

      return {
        protocolVersion: negotiatedVersion,
        agentInfo: deps.agentInfo,
        authMethods: [],
        agentCapabilities: {
          loadSession: loadSessionCapability,
          promptCapabilities: promptCapabilities,
          mcpCapabilities: mcpCapabilities,
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
      const session = sessions.create({
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        title: deriveSessionTitleFromCwd(params.cwd),
      });
      await persistSessionsBestEffort();
      const runtimeState = ensureSessionRuntimeState(session.id);

      await emitSessionInfoUpdateBestEffort(session.id);

      // Restore session state on creation
      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) await emitSessionUpdate(session.id, commandsUpdate);
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) await emitSessionUpdate(session.id, modeUpdate);

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
        modes: buildModesState(runtimeState.modeId),
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
    },

    async loadSession(params) {
      if (!loadSessionCapability) {
        throw new RequestError(-32601, '"Method not found": session/load');
      }
      await loadSessionInternal(params);

      let session = sessions.get(params.sessionId)!;
      const runtimeState = ensureSessionRuntimeState(session.id);

      if (typeof session.title !== 'string' || !session.title.trim()) {
        session =
          sessions.update(session.id, (current) => ({
            ...current,
            title: deriveSessionTitleFromCwd(current.cwd),
          })) ?? session;
        await persistSessionsBestEffort();
      }

      runtimeState.lastSessionInfoDigest = null;
      await emitSessionInfoUpdateBestEffort(session.id);

      // Restore plan state if session was running a task
      if (session.taskId && session.cwd) {
        await emitRuntimePlanUpdateIfNeeded({
          sessionId: session.id,
          repoPath: session.cwd,
          state: runtimeState,
        });
      }

      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) await emitSessionUpdate(session.id, commandsUpdate);
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) await emitSessionUpdate(session.id, modeUpdate);

      for (const entry of session.history) {
        if (entry.role !== 'assistant') continue;
        for (const block of entry.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            await emitSessionUpdate(session.id, {
              sessionUpdate: 'agent_message_chunk',
              content: buildTextContentBlock(block.text),
            });
          }
        }
      }

      const response: {
        configOptions: SessionConfigOption[];
        modes: SessionModeState;
        _meta?: Record<string, unknown>;
      } = {
        configOptions: buildConfigOptions(runtimeState),
        modes: buildModesState(runtimeState.modeId),
      };
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
        const resumeHint = toResumeHint(resumeProbe);
        response._meta = {
          salmonloop: {
            latestCheckpointId: latest?.id ?? null,
            checkpoint: toCheckpointMeta(latest),
            resumeReady,
            resumeProbe,
            resumeHint: resumeHint?.message ?? null,
            resumeHintCode: resumeHint?.code ?? null,
          },
        };
      } else {
        recordAuditEvent(
          'acp.checkpoint.read',
          {
            sessionId: params.sessionId,
            repoPathHash: hashRepoPath(params.cwd),
            latestCheckpointId: null,
            hit: false,
            reason: 'checkpoint_reader_missing',
          },
          { source: 'acp', severity: 'low', scope: 'session', phase: 'PREFLIGHT' },
        );
      }

      return response;
    },

    async setSessionConfigOption(params) {
      await hydrateSessionsOnce();
      if (!sessions.get(params.sessionId)) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      if (params.configId === ACP_PERMISSION_POLICY_CONFIG_ID) {
        if (!isPermissionPolicyValue(params.value)) {
          throw new RequestError(
            -32602,
            `Invalid params: unsupported value "${params.value}" for "${params.configId}"`,
          );
        }
        runtimeState.permissionPolicy = params.value;
      } else if (params.configId === ACP_MODE_CONFIG_ID) {
        if (!isSessionModeId(params.value)) {
          throw new RequestError(
            -32602,
            `Invalid params: unsupported value "${params.value}" for "${params.configId}"`,
          );
        }
        runtimeState.modeId = params.value;
      } else {
        throw new RequestError(-32602, `Invalid params: unsupported configId "${params.configId}"`);
      }
      sessions.update(params.sessionId, (current) => ({ ...current }));
      await persistSessionsBestEffort();
      await emitSessionInfoUpdateBestEffort(params.sessionId);
      const update = buildConfigOptionUpdateIfChanged(runtimeState);
      if (update) {
        await emitSessionUpdate(params.sessionId, update);
      }
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) {
        await emitSessionUpdate(params.sessionId, modeUpdate);
      }

      return { configOptions: buildConfigOptions(runtimeState) };
    },

    async setSessionMode(params) {
      await hydrateSessionsOnce();
      if (!sessions.get(params.sessionId)) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      if (!isSessionModeId(params.modeId)) {
        throw new RequestError(-32602, `Invalid params: unsupported modeId "${params.modeId}"`);
      }
      runtimeState.modeId = params.modeId;
      sessions.update(params.sessionId, (current) => ({ ...current }));
      await persistSessionsBestEffort();
      await emitSessionInfoUpdateBestEffort(params.sessionId);

      // Send mode update notification
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) {
        await emitSessionUpdate(params.sessionId, modeUpdate);
      }

      return {};
    },

    async prompt(params) {
      await hydrateSessionsOnce();
      const session = sessions.get(params.sessionId);
      if (!session) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      const caps = clientCapabilities ?? defaultClientCapabilities;
      const fsCaps = caps.fs;
      const clientExecutionReady =
        caps.terminal === true && Boolean(fsCaps?.readTextFile) && Boolean(fsCaps?.writeTextFile);
      const effectiveExecutionBinding =
        executionBinding === 'client' && !clientExecutionReady ? 'local' : executionBinding;

      const promptText = extractTextFromPrompt(params.prompt, promptCapabilities);
      const runtimeState = ensureSessionRuntimeState(params.sessionId);

      // Check for cancellation before starting processing
      if (sessions.get(params.sessionId)?.cancelRequested === true) {
        return { stopReason: 'cancelled' };
      }

      sessions.update(params.sessionId, (current) => {
        const title =
          typeof current.title === 'string' && current.title.trim()
            ? current.title
            : deriveSessionTitleFromCwd(current.cwd);
        return {
          ...current,
          cancelRequested: false,
          title,
          history: [
            ...current.history,
            { role: 'user', content: params.prompt as unknown as any[] },
          ],
        };
      });
      await persistSessionsBestEffort();
      await emitSessionInfoUpdateBestEffort(params.sessionId);

      const configUpdate = buildConfigOptionUpdateIfChanged(runtimeState);
      if (configUpdate) {
        await emitSessionUpdate(params.sessionId, configUpdate);
      }
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) {
        await emitSessionUpdate(params.sessionId, modeUpdate);
      }

      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) {
        await emitSessionUpdate(params.sessionId, commandsUpdate);
      }

      const slashInput = extractSlashInput(params.prompt);
      if (slashInput) {
        const parsed = parseSlashInput(slashInput);
        if (
          parsed.kind === 'slash' &&
          parsed.commandName &&
          isKnownSlashCommand(parsed.commandName)
        ) {
          const responseText = buildSlashHelpMessage();
          await emitSessionUpdate(params.sessionId, {
            sessionUpdate: 'agent_message_chunk',
            content: buildTextContentBlock(ensureMarkdownParagraphBreak(responseText)),
          });
          sessions.update(params.sessionId, (current) => ({
            ...current,
            history: [
              ...current.history,
              { role: 'assistant', content: [buildTextContentBlock(responseText)] as any },
            ],
          }));
          await persistSessionsBestEffort();
          await emitSessionInfoUpdateBestEffort(params.sessionId);

          return { stopReason: 'end_turn' };
        }
      }

      // Check for cancellation again before creating task
      if (sessions.get(params.sessionId)?.cancelRequested === true) {
        return { stopReason: 'cancelled' };
      }

      const pendingUpdates: Promise<void>[] = [];
      const executionRequest = buildCanonicalExecutionRequest({
        capability: 'patch',
        instruction: promptText,
        checkpointSessionId: params.sessionId,
        repoPath: session.cwd,
      });
      const { task, signal } = await deps.facade.createTask({
        ...executionRequest,
        commandRunner:
          effectiveExecutionBinding === 'client'
            ? createAcpCommandRunner({ conn: deps.conn, sessionId: params.sessionId })
            : undefined,
        fileSystemOverride:
          effectiveExecutionBinding === 'client'
            ? createAcpFileSystem({ conn: deps.conn, sessionId: params.sessionId })
            : undefined,
        authorizationProvider: createAcpToolAuthorizationProvider({
          conn: deps.conn,
          sessionId: params.sessionId,
          clientCapabilities: caps,
          getPermissionPolicy: () => getPermissionPolicyForAuthorization(runtimeState),
          enforceClientCapabilities: effectiveExecutionBinding === 'client',
        }),
        authorizationMode: 'blocking',
        onEvent: (event: LoopEvent) => {
          for (const update of loopEventToSessionUpdates(event, runtimeState)) {
            pendingUpdates.push(
              emitSessionUpdate(params.sessionId, update).catch(() => {
                // Ignore errors in session update notifications
              }),
            );
          }
          pendingUpdates.push(
            emitRuntimePlanUpdateIfNeeded({
              sessionId: params.sessionId,
              repoPath: session.cwd,
              event,
              state: runtimeState,
            }).catch(() => {
              // Ignore errors in plan update notifications
            }),
          );
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
        const inferred = inferTurnStopReasonFromFailure(latest?.failure);
        if (inferred) stopReason = inferred;
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

      sessions.update(params.sessionId, (current) => ({
        ...current,
        history: [
          ...current.history,
          { role: 'assistant', content: [buildTextContentBlock(assistantText)] as any },
        ],
      }));
      await persistSessionsBestEffort();

      const latestSession = sessions.get(params.sessionId);
      if (latestSession) {
        const sessionInfoUpdate = buildSessionInfoUpdateIfChanged(latestSession, runtimeState);
        if (sessionInfoUpdate) {
          pendingUpdates.push(
            emitSessionUpdate(params.sessionId, sessionInfoUpdate).catch(() => {
              // Ignore errors in session update notifications
            }),
          );
        }
      }

      // Wait for all pending session updates to be sent before responding
      await Promise.all(pendingUpdates);

      return { stopReason };
    },

    async cancel(params) {
      await hydrateSessionsOnce();
      const session = sessions.get(params.sessionId);
      if (!session) return;

      // Mark the session as cancelled
      sessions.update(params.sessionId, (current) => ({ ...current, cancelRequested: true }));
      await persistSessionsBestEffort();
      await emitSessionInfoUpdateBestEffort(params.sessionId);

      // If a task is running, cancel it
      if (session.taskId) {
        await deps.facade.cancelTask(session.taskId);
      }

      // Note: The prompt method will check the cancelRequested flag and return
      // StopReason::Cancelled as required by the protocol
    },

    extMethod: async () => ({}),
    extNotification: async () => {},
  };
}
