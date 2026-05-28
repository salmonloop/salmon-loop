import {
  PROTOCOL_VERSION,
  RequestError,
  type Agent,
  type AgentSideConnection,
  type ClientCapabilities,
  type ContentBlock,
  type LoadSessionRequest,
  type McpServer,
  type SessionConfigOption,
  type SessionInfo,
  type SessionModeState,
  type SessionUpdate,
  type StopReason,
  type ToolCallContent,
} from '@agentclientprotocol/sdk';

import { text } from '../../../locales/index.js';
import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import type { ResolvedExtensions, ResolvedMcpServer } from '../../extensions/types.js';
import type { TaskEvent } from '../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../interaction/model/index.js';
import { inferTurnStopReasonFromFailure } from '../../interaction/turn-stop-reason.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { toAcpPublicModes } from '../../public-capabilities/projections.js';
import { buildPublicCapabilityRegistry } from '../../public-capabilities/registry.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import { parseSlashInput } from '../../slash/parser.js';
import type { FileSystem } from '../../types/index.js';
import type { LoopEvent } from '../../types/index.js';
import { Phase, type FlowMode } from '../../types/runtime.js';
import { buildCanonicalExecutionRequest } from '../shared/execution-request.js';
import { parseAcpFlowMode } from '../shared/flow-mode-mapping.js';

import {
  probeCheckpoint,
  probeCheckpointForNewSession,
  type CheckpointReader,
} from './acp-checkpoint-probe.js';
import { createAcpCommandRunner } from './acp-command-runner.js';
import { createAcpFileSystem } from './acp-filesystem.js';
import { createAcpSessionPersistence } from './acp-session-persistence.js';
import {
  ACP_PERMISSION_POLICY_ASK,
  ACP_PERMISSION_POLICY_ALLOW_ALL,
  ACP_PERMISSION_POLICY_DENY_ALL,
  hashRepoPath,
  isPermissionPolicyValue,
  parseTimestamp,
  type AcpPermissionPolicy,
} from './acp-types.js';
import { createAcpSessionStore, isTerminalTaskEvent, type AcpSessionRecord } from './handlers.js';
import { createAcpToolAuthorizationProvider } from './permission-provider.js';
import { mapToolKind } from './tool-kind-mapping.js';

type Facade = {
  createTask: (input: {
    capability: string;
    request: { instruction: string; checkpointSessionId?: string; repoPath?: string };
    onEvent?: (event: LoopEvent) => void;
    authorizationProvider?: import('../../tools/authorization/types.js').ToolAuthorizationProvider;
    authorizationMode?: 'blocking' | 'deferred';
    commandRunner?: CommandRunner;
    fileSystemOverride?: FileSystem;
    extensions?: ResolvedExtensions;
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

type AcpSessionModeId = FlowMode;

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

type AcpSessionLifecycleRequest = {
  sessionId: string;
  cwd: string;
  mcpServers?: McpServer[];
  additionalDirectories?: string[];
};

const ACP_PERMISSION_POLICY_CONFIG_ID = '_salmonloop_permission_policy';
const ACP_MODE_CONFIG_ID = '_salmonloop_mode';
const ACP_DEFAULT_MODE_ID: AcpSessionModeId = 'autopilot';
const ACP_SESSION_STORE_MAX_ENTRIES = 200;
const ACP_SESSION_STORE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const ACP_SESSION_STORE_LOCK_STALE_MS = 1000 * 30;
const ACP_SESSION_STORE_LOCK_HEARTBEAT_MS = 1000 * 5;
const ACP_SESSION_STORE_LOCK_ACQUIRE_TIMEOUT_MS = 1000 * 5;
const ACP_SESSION_HISTORY_MAX_ENTRIES = 40;
const ACP_SESSION_LIST_PAGE_SIZE = 50;
const ACP_SUPPORTED_PROTOCOL_VERSIONS = new Set<number>([PROTOCOL_VERSION]);

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

function encodeSessionListCursor(input: { offset: number; cwd: string | null }): string {
  return `${input.offset}:${input.cwd ?? ''}`;
}

function decodeSessionListCursor(cursor: string): { offset: number; cwd: string | null } {
  const colon = cursor.indexOf(':');
  if (colon < 0) {
    throw new RequestError(-32602, 'Invalid params: invalid session/list cursor');
  }
  const offset = Number(cursor.slice(0, colon));
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RequestError(-32602, 'Invalid params: invalid session/list cursor');
  }
  const cwd = cursor.slice(colon + 1) || null;
  return { offset, cwd };
}

function isReplayableSessionContentBlock(block: Record<string, unknown>): block is ContentBlock {
  if (!block || typeof block !== 'object') return false;
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string';
    case 'resource_link':
      return typeof block.name === 'string' && typeof block.uri === 'string';
    default:
      return false;
  }
}

const ACP_AVAILABLE_COMMANDS: Array<{ name: string; description: string }> = [
  { name: 'help', description: text.acp.slashHelpDescription },
];

const ACP_PUBLIC_MODES = toAcpPublicModes(buildPublicCapabilityRegistry());
const ACP_PUBLIC_MODE_IDS = new Set<AcpSessionModeId>(ACP_PUBLIC_MODES.map((mode) => mode.id));

function resolveExposedAcpModeId(
  value: unknown,
  fallback: AcpSessionModeId = ACP_DEFAULT_MODE_ID,
): AcpSessionModeId {
  const resolvedModeId = parseAcpFlowMode(value);
  if (resolvedModeId && ACP_PUBLIC_MODE_IDS.has(resolvedModeId)) {
    return resolvedModeId;
  }
  return fallback;
}

function formatResourceLink(block: Extract<ContentBlock, { type: 'resource_link' }>): string {
  const title = block.title ?? block.name ?? block.uri;
  const description = block.description ? ` - ${block.description}` : '';
  return `Resource: ${title} (${block.uri})${description}`;
}

function formatEmbeddedResource(block: Extract<ContentBlock, { type: 'resource' }>): string {
  const resource = block.resource as {
    uri?: unknown;
    mimeType?: unknown;
    text?: unknown;
    blob?: unknown;
  };
  const uri = typeof resource.uri === 'string' ? resource.uri : 'embedded-resource';
  const mimeType = typeof resource.mimeType === 'string' ? resource.mimeType : undefined;
  if (typeof resource.text === 'string') {
    const header = mimeType
      ? `Embedded resource: ${uri} (${mimeType})`
      : `Embedded resource: ${uri}`;
    return `${header}\n${resource.text}`;
  }
  const header = mimeType
    ? `Embedded binary resource: ${uri} (${mimeType})`
    : `Embedded binary resource: ${uri}`;
  return header;
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
          throw new RequestError(-32602, 'Prompt content type image is not supported');
        }
        break;
      case 'audio':
        if (!capabilities.audio) {
          throw new RequestError(-32602, 'Prompt content type audio is not supported');
        }
        break;
      case 'resource':
        if (!capabilities.embeddedContext) {
          throw new RequestError(-32602, 'Prompt content type resource is not supported');
        }
        parts.push(formatEmbeddedResource(block));
        break;
      default:
        throw new RequestError(-32602, 'Invalid params: unsupported content block type');
    }
  }
  return parts.join('\n');
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
        kind: mapToolKind(event.toolName, { intent: event.toolIntent }),
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
        {
          value: ACP_PERMISSION_POLICY_ALLOW_ALL,
          name: text.acp.permissionPolicyAllowAllName,
          description: text.acp.permissionPolicyAllowAllDescription,
        },
      ],
    },
    {
      type: 'select',
      id: ACP_MODE_CONFIG_ID,
      name: text.acp.executionFlowName,
      description: text.acp.executionFlowDescription,
      currentValue: state.modeId,
      options: ACP_PUBLIC_MODES.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description,
      })),
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

function buildCurrentModeUpdate(modeId: AcpSessionModeId): SessionUpdate {
  return { sessionUpdate: 'current_mode_update', currentModeId: modeId };
}

function buildModesState(modeId: AcpSessionModeId): SessionModeState {
  return {
    currentModeId: modeId,
    availableModes: ACP_PUBLIC_MODES.map((mode) => ({ ...mode })),
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
  return state.permissionPolicy;
}

function createSessionRuntimeStateFromPersisted(input?: {
  permissionPolicy?: unknown;
  defaultPermissionPolicy?: unknown;
  modeId?: unknown;
  defaultModeId?: AcpSessionModeId;
}): AcpSessionRuntimeState {
  const defaultPermissionPolicy = isPermissionPolicyValue(String(input?.defaultPermissionPolicy))
    ? (input?.defaultPermissionPolicy as AcpPermissionPolicy)
    : ACP_PERMISSION_POLICY_ASK;
  const permissionPolicy = isPermissionPolicyValue(String(input?.permissionPolicy))
    ? (input?.permissionPolicy as AcpPermissionPolicy)
    : defaultPermissionPolicy;
  const defaultModeId = resolveExposedAcpModeId(input?.defaultModeId);
  const modeId = resolveExposedAcpModeId(input?.modeId, defaultModeId);
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

function envListToRecord(env: Array<{ name: string; value: string }>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of env) {
    record[entry.name] = entry.value;
  }
  return record;
}

function headersListToRecord(
  headers: Array<{ name: string; value: string }>,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of headers) {
    record[entry.name] = entry.value;
  }
  return record;
}

function defaultAcpMcpCapabilities(): ResolvedMcpServer['capabilities'] {
  return {
    tools: {
      exposeToModel: true,
      allow: ['*'],
      phases: [Phase.VERIFY],
      approval: 'ask',
    },
    resources: {
      allowUris: [],
      autoInclude: false,
      subscribe: false,
      maxBytes: 64_000,
      ttlMs: 30_000,
    },
    prompts: {
      exposeAs: 'none',
      allow: [],
    },
    roots: { mode: 'none' },
    sampling: { enabled: false, maxTokens: 0, maxDepth: 0 },
    elicitation: { enabled: false },
  };
}

function acpMcpServersToResolved(mcpServers: McpServer[] | undefined): ResolvedMcpServer[] {
  if (!Array.isArray(mcpServers)) return [];
  const resolved: ResolvedMcpServer[] = [];
  for (const server of mcpServers) {
    const transportType = 'type' in server ? server.type : 'stdio';
    if (transportType === 'sse' || transportType === 'acp') {
      throw new RequestError(
        -32602,
        `Invalid params: unsupported MCP server transport "${transportType}"`,
      );
    }
    if ('type' in server && server.type === 'http') {
      const httpServer = server;
      resolved.push({
        name: httpServer.name,
        enabled: true,
        transport: {
          type: 'http',
          url: httpServer.url,
          headers: headersListToRecord(httpServer.headers),
        },
        auth: { type: 'none', scopes: [] },
        trust: 'remote',
        capabilities: defaultAcpMcpCapabilities(),
        scope: 'repo',
      });
      continue;
    }
    if (transportType !== 'stdio') {
      throw new RequestError(
        -32602,
        `Invalid params: unsupported MCP server transport "${transportType}"`,
      );
    }
    const stdioServer = server as {
      name: string;
      command: string;
      args: Array<string>;
      env: Array<{ name: string; value: string }>;
    };
    resolved.push({
      name: stdioServer.name,
      enabled: true,
      transport: {
        type: 'stdio',
        command: stdioServer.command,
        args: stdioServer.args,
        env: envListToRecord(stdioServer.env),
      },
      auth: { type: 'none', scopes: [] },
      trust: 'local',
      capabilities: defaultAcpMcpCapabilities(),
      scope: 'repo',
    });
  }
  return resolved;
}

function acpMcpServersToExtensions(
  mcpServers: McpServer[] | undefined,
): ResolvedExtensions | undefined {
  const resolvedServers = acpMcpServersToResolved(mcpServers);
  if (resolvedServers.length === 0) return undefined;
  return {
    mcpServers: resolvedServers,
    toolPlugins: [],
    skillDiscovery: { paths: [], scope: 'repo' },
  };
}

function validateAcpMcpServers(mcpServers: McpServer[] | undefined): void {
  void acpMcpServersToResolved(mcpServers);
}

function validateUnsupportedAdditionalDirectories(
  additionalDirectories: string[] | undefined,
): void {
  if (Array.isArray(additionalDirectories) && additionalDirectories.length > 0) {
    throw new RequestError(
      -32602,
      'Invalid params: additionalDirectories is not supported by this agent',
    );
  }
}

function negotiateProtocolVersion(clientProtocolVersion: number): number {
  if (ACP_SUPPORTED_PROTOCOL_VERSIONS.has(clientProtocolVersion)) {
    return clientProtocolVersion;
  }
  return PROTOCOL_VERSION;
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

function isPersistableSession(session: AcpSessionRecord): boolean {
  return session.materialized || session.history.length > 0 || typeof session.taskId === 'string';
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
  defaultPermissionPolicy?: AcpPermissionPolicy;
  planReader?: {
    readBySession: (input: { repoPath: string; sessionId: string }) => Promise<CorePlanReadResult>;
  };
  checkpointReader?: CheckpointReader;
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
      acp?: boolean;
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
    http: deps.capabilityPolicy?.mcpCapabilities?.http ?? true,
    sse: deps.capabilityPolicy?.mcpCapabilities?.sse ?? false,
    acp: deps.capabilityPolicy?.mcpCapabilities?.acp ?? false,
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
  const sessionPersistence = createAcpSessionPersistence({
    path: sessionPersistencePath ?? '',
    storePolicy: sessionStorePolicy,
    defaultPermissionPolicy: deps.defaultPermissionPolicy ?? ACP_PERMISSION_POLICY_ASK,
    defaultModeId: deps.defaultModeId,
    sessions,
    sessionRuntime,
    isPersistableSession,
    ensureSessionRuntimeState,
    resolveExposedAcpModeId,
  });

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
    const planReader = deps.planReader;

    if (event?.type === 'plan.runtime.ready') {
      state.runtimePlanSessionId = event.sessionId;
      state.runtimePlanPathHint = event.planPathHint;
      state.lastPlanDigest = null;
    }

    if (!state.runtimePlanSessionId || !planReader) return;

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
    await sessionPersistence.hydrate();
    validateUnsupportedAdditionalDirectories(params.additionalDirectories);
    validateAcpMcpServers(params.mcpServers);
    const session = sessions.get(params.sessionId);
    if (!session) {
      throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
    }
    if (session.cwd !== params.cwd) {
      throw new RequestError(-32602, 'Invalid params: cwd does not match session cwd');
    }
    if (params.mcpServers) {
      sessions.update(params.sessionId, (current) => ({
        ...current,
        mcpServers: params.mcpServers,
      }));
      await sessionPersistence.persist();
    }
    return session;
  }

  async function resumeSessionInternal(
    params: AcpSessionLifecycleRequest,
  ): Promise<AcpSessionRecord> {
    await sessionPersistence.hydrate();
    validateUnsupportedAdditionalDirectories(params.additionalDirectories);
    validateAcpMcpServers(params.mcpServers);
    const session = sessions.get(params.sessionId);
    if (!session) {
      throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
    }
    if (session.cwd !== params.cwd) {
      throw new RequestError(-32602, 'Invalid params: cwd does not match session cwd');
    }
    if (params.mcpServers) {
      sessions.update(params.sessionId, (current) => ({
        ...current,
        mcpServers: params.mcpServers ?? [],
      }));
      await sessionPersistence.persist();
    }
    return session;
  }

  function toSessionInfo(session: AcpSessionRecord): SessionInfo {
    return {
      sessionId: session.id,
      cwd: session.cwd,
      title: typeof session.title === 'string' && session.title.trim() ? session.title : null,
      updatedAt: session.updatedAt,
    };
  }

  function ensureSessionRuntimeState(sessionId: string): AcpSessionRuntimeState {
    const existing = sessionRuntime.get(sessionId);
    if (existing) return existing;
    const session = sessions.get(sessionId);
    const created = createSessionRuntimeStateFromPersisted({
      permissionPolicy: session?.permissionPolicy,
      defaultPermissionPolicy: deps.defaultPermissionPolicy,
      modeId: session?.modeId,
      defaultModeId: deps.defaultModeId,
    });
    sessionRuntime.set(sessionId, created);
    return created;
  }

  async function cancelSessionTaskBestEffort(session: AcpSessionRecord): Promise<void> {
    sessions.update(session.id, (current) => ({ ...current, cancelRequested: true }));
    if (session.taskId) {
      await deps.facade.cancelTask(session.taskId);
    }
  }

  async function closeSessionRecord(params: { sessionId: string }): Promise<void> {
    const session = sessions.get(params.sessionId);
    if (!session) return;
    const runtimeState = ensureSessionRuntimeState(params.sessionId);
    sessions.update(params.sessionId, (current) => ({
      ...current,
      permissionPolicy: runtimeState.permissionPolicy,
      modeId: runtimeState.modeId,
    }));
    await cancelSessionTaskBestEffort(session);
    const latestSession = sessions.get(params.sessionId) ?? session;
    if (!isPersistableSession(latestSession)) {
      sessionRuntime.delete(params.sessionId);
      sessions.delete(params.sessionId);
      await sessionPersistence.persist();
      return;
    }
    sessions.update(params.sessionId, (current) => ({ ...current, cancelRequested: false }));
    await sessionPersistence.persist();
    sessionRuntime.delete(params.sessionId);
  }

  async function deleteSessionRecord(params: { sessionId: string }): Promise<void> {
    const session = sessions.get(params.sessionId);
    if (!session) return;
    await cancelSessionTaskBestEffort(session);
    sessionPersistence.markDeleted(params.sessionId);
    sessionRuntime.delete(params.sessionId);
    sessions.delete(params.sessionId);
    await sessionPersistence.persist();
  }

  return {
    async initialize(params) {
      if (typeof params.protocolVersion !== 'number' || !Number.isFinite(params.protocolVersion)) {
        throw new RequestError(-32602, 'Invalid params: protocolVersion is required');
      }

      clientCapabilities = params.clientCapabilities;

      return {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        agentInfo: deps.agentInfo,
        authMethods: [],
        agentCapabilities: {
          loadSession: loadSessionCapability,
          promptCapabilities: promptCapabilities,
          mcpCapabilities: mcpCapabilities,
          sessionCapabilities: {
            list: {},
            resume: {},
            close: {},
            delete: {},
          },
        },
      };
    },

    async authenticate(params) {
      throw new RequestError(
        -32602,
        `Invalid params: unsupported auth methodId "${params.methodId}"`,
      );
    },

    async newSession(params) {
      await sessionPersistence.hydrate();
      if (!isAbsolutePath(params.cwd)) {
        throw new RequestError(-32602, 'Invalid params: cwd must be an absolute path');
      }
      validateUnsupportedAdditionalDirectories(params.additionalDirectories);
      validateAcpMcpServers(params.mcpServers);
      const session = sessions.create({
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        title: deriveSessionTitleFromCwd(params.cwd),
        permissionPolicy: isPermissionPolicyValue(String(deps.defaultPermissionPolicy))
          ? deps.defaultPermissionPolicy
          : ACP_PERMISSION_POLICY_ASK,
        modeId: resolveExposedAcpModeId(deps.defaultModeId),
      });
      const runtimeState = ensureSessionRuntimeState(session.id);

      await emitSessionInfoUpdateBestEffort(session.id);

      // Restore session state on creation
      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) await emitSessionUpdate(session.id, commandsUpdate);
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) await emitSessionUpdate(session.id, modeUpdate);

      let sessionMeta: Record<string, unknown> | undefined;
      if (deps.checkpointReader) {
        const result = await probeCheckpointForNewSession(deps.checkpointReader, {
          repoPath: params.cwd,
          sessionId: session.id,
        });
        sessionMeta = result._meta;
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
        await sessionPersistence.persist();
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
        for (const block of entry.content) {
          if (isReplayableSessionContentBlock(block)) {
            await emitSessionUpdate(session.id, {
              sessionUpdate:
                entry.role === 'assistant' ? 'agent_message_chunk' : 'user_message_chunk',
              content: block,
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
        const result = await probeCheckpoint(deps.checkpointReader, {
          repoPath: params.cwd,
          sessionId: params.sessionId,
          repoPathHash: hashRepoPath(params.cwd),
        });
        response._meta = result._meta;
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

    async listSessions(params) {
      await sessionPersistence.hydrate();
      if (typeof params.cwd === 'string' && params.cwd && !isAbsolutePath(params.cwd)) {
        throw new RequestError(-32602, 'Invalid params: cwd must be an absolute path');
      }
      const cwdFilter = typeof params.cwd === 'string' && params.cwd ? params.cwd : null;
      let offset = 0;
      if (typeof params.cursor === 'string' && params.cursor) {
        const decodedCursor = decodeSessionListCursor(params.cursor);
        if (decodedCursor.cwd !== cwdFilter) {
          throw new RequestError(-32602, 'Invalid params: cursor does not match cwd filter');
        }
        offset = decodedCursor.offset;
      }
      const filtered = sessions
        .list()
        .filter((session) => !cwdFilter || session.cwd === cwdFilter)
        .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
      const page = filtered.slice(offset, offset + ACP_SESSION_LIST_PAGE_SIZE);
      const nextOffset = offset + page.length;
      const nextCursor =
        nextOffset < filtered.length
          ? encodeSessionListCursor({ offset: nextOffset, cwd: cwdFilter })
          : undefined;
      return {
        sessions: page.map(toSessionInfo),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },

    async resumeSession(params) {
      const session = await resumeSessionInternal({
        sessionId: params.sessionId,
        cwd: params.cwd,
        mcpServers: params.mcpServers,
        additionalDirectories: params.additionalDirectories,
      });
      const runtimeState = ensureSessionRuntimeState(session.id);
      runtimeState.lastSessionInfoDigest = null;
      await emitSessionInfoUpdateBestEffort(session.id);
      const commandsUpdate = buildAvailableCommandsUpdateIfChanged(runtimeState);
      if (commandsUpdate) await emitSessionUpdate(session.id, commandsUpdate);
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) await emitSessionUpdate(session.id, modeUpdate);
      const response: {
        configOptions: SessionConfigOption[];
        modes: SessionModeState;
        _meta?: Record<string, unknown>;
      } = {
        configOptions: buildConfigOptions(runtimeState),
        modes: buildModesState(runtimeState.modeId),
      };
      if (deps.checkpointReader) {
        const result = await probeCheckpoint(deps.checkpointReader, {
          repoPath: session.cwd,
          sessionId: params.sessionId,
          repoPathHash: hashRepoPath(session.cwd),
        });
        response._meta = result._meta;
      }
      return response;
    },

    async closeSession(params) {
      await sessionPersistence.hydrate();
      await closeSessionRecord({ sessionId: params.sessionId });
      return {};
    },

    async unstable_deleteSession(params) {
      await sessionPersistence.hydrate();
      await deleteSessionRecord({ sessionId: params.sessionId });
      return {};
    },

    async setSessionConfigOption(params) {
      await sessionPersistence.hydrate();
      if (!sessions.get(params.sessionId)) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      if (params.configId === ACP_PERMISSION_POLICY_CONFIG_ID) {
        if (typeof params.value !== 'string') {
          throw new RequestError(
            -32602,
            `Invalid params: "${params.configId}" does not support boolean values`,
          );
        }
        if (!isPermissionPolicyValue(params.value)) {
          throw new RequestError(
            -32602,
            `Invalid params: unsupported value "${params.value}" for "${params.configId}"`,
          );
        }
        runtimeState.permissionPolicy = params.value;
      } else if (params.configId === ACP_MODE_CONFIG_ID) {
        if (typeof params.value !== 'string') {
          throw new RequestError(
            -32602,
            `Invalid params: "${params.configId}" does not support boolean values`,
          );
        }
        const parsedModeId = parseAcpFlowMode(params.value);
        if (!parsedModeId || !ACP_PUBLIC_MODE_IDS.has(parsedModeId)) {
          throw new RequestError(
            -32602,
            `Invalid params: unsupported value "${params.value}" for "${params.configId}"`,
          );
        }
        runtimeState.modeId = parsedModeId;
      } else {
        throw new RequestError(-32602, `Invalid params: unsupported configId "${params.configId}"`);
      }
      sessions.update(params.sessionId, (current) => ({
        ...current,
        permissionPolicy: runtimeState.permissionPolicy,
        modeId: runtimeState.modeId,
      }));
      await sessionPersistence.persist();
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
      await sessionPersistence.hydrate();
      if (!sessions.get(params.sessionId)) {
        throw new RequestError(-32004, `Session not found: ${params.sessionId}`);
      }

      const runtimeState = ensureSessionRuntimeState(params.sessionId);
      const resolvedModeId = parseAcpFlowMode(params.modeId);
      if (!resolvedModeId || !ACP_PUBLIC_MODE_IDS.has(resolvedModeId)) {
        throw new RequestError(-32602, `Invalid params: unsupported modeId "${params.modeId}"`);
      }
      runtimeState.modeId = resolvedModeId;
      sessions.update(params.sessionId, (current) => ({
        ...current,
        permissionPolicy: runtimeState.permissionPolicy,
        modeId: runtimeState.modeId,
      }));
      await sessionPersistence.persist();
      await emitSessionInfoUpdateBestEffort(params.sessionId);

      const configUpdate = buildConfigOptionUpdateIfChanged(runtimeState);
      if (configUpdate) {
        await emitSessionUpdate(params.sessionId, configUpdate);
      }

      // Send mode update notification
      const modeUpdate = buildCurrentModeUpdateIfChanged(runtimeState);
      if (modeUpdate) {
        await emitSessionUpdate(params.sessionId, modeUpdate);
      }

      return {};
    },

    async prompt(params) {
      await sessionPersistence.hydrate();
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
        return {
          stopReason: 'cancelled',
          ...(params.messageId ? { userMessageId: params.messageId } : {}),
        };
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
          materialized: true,
          permissionPolicy: runtimeState.permissionPolicy,
          modeId: runtimeState.modeId,
          history: [
            ...current.history,
            { role: 'user', content: params.prompt as unknown as any[] },
          ],
        };
      });
      await sessionPersistence.persist();
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
          await sessionPersistence.persist();
          await emitSessionInfoUpdateBestEffort(params.sessionId);

          return {
            stopReason: 'end_turn',
            ...(params.messageId ? { userMessageId: params.messageId } : {}),
          };
        }
      }

      // Check for cancellation again before creating task
      if (sessions.get(params.sessionId)?.cancelRequested === true) {
        return {
          stopReason: 'cancelled',
          ...(params.messageId ? { userMessageId: params.messageId } : {}),
        };
      }

      const pendingUpdates: Promise<void>[] = [];
      const executionRequest = buildCanonicalExecutionRequest({
        capability: runtimeState.modeId,
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
        extensions: acpMcpServersToExtensions(session.mcpServers),
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
      await sessionPersistence.persist();

      if (signal.aborted) {
        await emitSessionUpdate(params.sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: buildTextContentBlock(ensureMarkdownParagraphBreak('Task cancelled.')),
        });
        return {
          stopReason: 'cancelled',
          ...(params.messageId ? { userMessageId: params.messageId } : {}),
        };
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
      await sessionPersistence.persist();

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

      return {
        stopReason,
        ...(params.messageId ? { userMessageId: params.messageId } : {}),
      };
    },

    async cancel(params) {
      await sessionPersistence.hydrate();
      const session = sessions.get(params.sessionId);
      if (!session) return;

      // Mark the session as cancelled
      sessions.update(params.sessionId, (current) => ({ ...current, cancelRequested: true }));
      await sessionPersistence.persist();
      await emitSessionInfoUpdateBestEffort(params.sessionId);

      // If a task is running, cancel it
      if (session.taskId) {
        await deps.facade.cancelTask(session.taskId);
      }

      // Note: The prompt method will check the cancelRequested flag and return
      // StopReason::Cancelled as required by the protocol
    },
  };
}
