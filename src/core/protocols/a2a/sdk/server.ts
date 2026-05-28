import type {
  AgentCard,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
  TaskArtifactUpdateEvent,
  TaskQueryParams,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk';
import {
  A2AError,
  type AgentExecutor,
  type ExtendedAgentCardProvider,
  InMemoryPushNotificationStore,
  type PushNotificationSender,
  type PushNotificationStore,
  type ServerCallContext,
  type TaskStore,
  DefaultRequestHandler,
} from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
  type UserBuilder as A2AUserBuilder,
} from '@a2a-js/sdk/server/express';
import express, { type Express, type RequestHandler } from 'express';

export type CreateA2ASdkExpressAppOptions = {
  agentCard: AgentCard;
  agentExecutor: AgentExecutor;
  taskStore?: TaskStore;
  pushNotificationStore?: PushNotificationStore;
  pushNotificationSender?: PushNotificationSender;
  extendedAgentCardProvider?: AgentCard | ExtendedAgentCardProvider;
  userBuilder?: A2AUserBuilder;
  authMiddleware?: RequestHandler;
  agentCardPath?: string;
  rpcPath?: string;
};

type ListTasksParams = {
  tenant?: string;
  contextId?: string;
  status?: string;
  pageSize?: number;
  pageToken?: string;
  historyLength?: number;
  statusTimestampAfter?: string;
  includeArtifacts?: boolean;
};

type ListTasksQuery = {
  contextId?: string;
  status?: Task['status']['state'];
  pageSize: number;
  pageToken?: string;
  statusTimestampAfter?: string;
};

type ListTasksResult = {
  tasks: Task[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
};

type PushNotificationAuthentication = {
  scheme?: string;
  credentials?: string;
};

type ParsedPushNotificationConfigParams = {
  taskId: string;
  id: string;
  url: string;
  token?: string;
  authentication?: PushNotificationAuthentication;
};

type PushNotificationConfigParams = {
  taskId?: string;
  id?: string;
  url?: string;
  token?: string;
  authentication?: PushNotificationAuthentication;
};

type PushNotificationConfigLookupParams = {
  taskId?: string;
  id?: string;
};

type ListPushNotificationConfigsParams = {
  taskId?: string;
  pageSize?: number;
  pageToken?: string;
};

type ListableTaskStore = TaskStore & {
  listTasks(query: ListTasksQuery, context?: ServerCallContext): Promise<ListTasksResult>;
};

export class ProtocolAlignedInMemoryTaskStore implements ListableTaskStore {
  private readonly tasks = new Map<string, Task>();

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async load(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async listTasks(query: ListTasksQuery): Promise<ListTasksResult> {
    let tasks = [...this.tasks.values()];

    if (query.contextId) {
      tasks = tasks.filter((task) => task.contextId === query.contextId);
    }

    if (query.status) {
      tasks = tasks.filter((task) => task.status.state === query.status);
    }

    if (query.statusTimestampAfter) {
      const threshold = Date.parse(query.statusTimestampAfter);
      tasks = tasks.filter((task) => {
        if (!task.status.timestamp) {
          return false;
        }
        const timestamp = Date.parse(task.status.timestamp);
        return Number.isFinite(timestamp) && timestamp >= threshold;
      });
    }

    tasks = tasks.sort(compareTasksByLastUpdateDesc);

    const totalSize = tasks.length;

    if (query.pageToken) {
      const cursorIndex = tasks.findIndex((task) => task.id === query.pageToken);
      if (cursorIndex < 0) {
        throw A2AError.invalidParams(`Unknown pageToken: ${query.pageToken}`);
      }
      tasks = tasks.slice(cursorIndex + 1);
    }

    const pageTasks = tasks.slice(0, query.pageSize);
    const nextPageToken =
      tasks.length > pageTasks.length && pageTasks.length > 0
        ? (pageTasks[pageTasks.length - 1]?.id ?? '')
        : '';

    return {
      tasks: pageTasks,
      nextPageToken,
      pageSize: query.pageSize,
      totalSize,
    };
  }
}

function compareTasksByLastUpdateDesc(left: Task, right: Task): number {
  const leftTimestamp = parseTaskStatusTimestamp(left);
  const rightTimestamp = parseTaskStatusTimestamp(right);

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return left.id.localeCompare(right.id);
}

function parseTaskStatusTimestamp(task: Task): number {
  if (!task.status.timestamp) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(task.status.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

class ProtocolAlignedRequestHandler extends DefaultRequestHandler {
  constructor(
    private readonly agentCardRef: AgentCard,
    private readonly taskStoreRef: TaskStore,
    agentExecutor: AgentExecutor,
    private readonly pushNotificationStoreRef?: PushNotificationStore,
    private readonly pushNotificationSenderRef?: PushNotificationSender,
    private readonly extendedAgentCardProviderRef?: AgentCard | ExtendedAgentCardProvider,
  ) {
    super(
      agentCardRef,
      taskStoreRef,
      agentExecutor,
      undefined,
      pushNotificationStoreRef,
      pushNotificationSenderRef,
      extendedAgentCardProviderRef,
    );
  }

  override async sendMessage(
    params: MessageSendParams,
    context?: ServerCallContext,
  ): Promise<Message | Task> {
    const result = await super.sendMessage(params, context);
    if (result.kind !== 'task') {
      return result;
    }
    return applyHistoryLength(result, params.configuration?.historyLength);
  }

  override async *sendMessageStream(
    params: MessageSendParams,
    context?: ServerCallContext,
  ): AsyncGenerator<
    Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
    void,
    undefined
  > {
    for await (const event of super.sendMessageStream(params, context)) {
      if (event.kind !== 'task') {
        yield event;
        continue;
      }
      yield applyHistoryLength(event, params.configuration?.historyLength);
    }
  }

  override async getTask(params: TaskQueryParams, context?: ServerCallContext): Promise<Task> {
    const task = await this.taskStoreRef.load(params.id, context);
    if (!task) {
      throw A2AError.taskNotFound(params.id);
    }
    return applyHistoryLength(task, params.historyLength);
  }

  override async getAuthenticatedExtendedAgentCard(
    context?: ServerCallContext,
  ): Promise<AgentCard> {
    if (!supportsExtendedAgentCard(this.agentCardRef)) {
      throw A2AError.unsupportedOperation('Agent does not support authenticated extended card.');
    }

    if (!context?.user?.isAuthenticated) {
      throw A2AError.invalidRequest('Authentication required for authenticated extended card.');
    }

    if (!this.extendedAgentCardProviderRef) {
      throw A2AError.authenticatedExtendedCardNotConfigured();
    }

    if (typeof this.extendedAgentCardProviderRef === 'function') {
      return this.extendedAgentCardProviderRef(context);
    }

    return this.extendedAgentCardProviderRef;
  }
}

type AgentCapabilitiesWithExtendedCard = AgentCard['capabilities'] & {
  extendedAgentCard?: boolean;
  extensions?: Array<{
    uri?: string;
    required?: boolean;
  }>;
};

const JSON_RPC_METHOD_ALIASES: Readonly<Record<string, string>> = {
  SendMessage: 'message/send',
  SendStreamingMessage: 'message/stream',
  GetTask: 'tasks/get',
  CancelTask: 'tasks/cancel',
  SubscribeToTask: 'tasks/resubscribe',
  CreateTaskPushNotificationConfig: 'tasks/pushNotificationConfig/set',
  GetTaskPushNotificationConfig: 'tasks/pushNotificationConfig/get',
  ListTaskPushNotificationConfigs: 'tasks/pushNotificationConfig/list',
  DeleteTaskPushNotificationConfig: 'tasks/pushNotificationConfig/delete',
  GetExtendedAgentCard: 'agent/getAuthenticatedExtendedCard',
};

const OFFICIAL_A2A_EXTENSIONS_HEADER = 'A2A-Extensions';
const LEGACY_A2A_EXTENSIONS_HEADER = 'X-A2A-Extensions';
const LEGACY_JSON_RPC_METHODS = new Set(Object.values(JSON_RPC_METHOD_ALIASES));
const SUPPORTED_A2A_VERSIONS = new Set(['0.3', '1.0']);
const DEFAULT_LIST_TASKS_PAGE_SIZE = 50;
const MAX_LIST_TASKS_PAGE_SIZE = 100;
const RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const TASK_STATE_FILTERS: Readonly<Record<string, Task['status']['state'] | undefined>> = {
  TASK_STATE_UNSPECIFIED: undefined,
  TASK_STATE_SUBMITTED: 'submitted',
  TASK_STATE_WORKING: 'working',
  TASK_STATE_COMPLETED: 'completed',
  TASK_STATE_FAILED: 'failed',
  TASK_STATE_CANCELED: 'canceled',
  TASK_STATE_INPUT_REQUIRED: 'input-required',
  TASK_STATE_REJECTED: 'rejected',
  TASK_STATE_AUTH_REQUIRED: 'auth-required',
};

const TERMINAL_TASK_STATES = new Set<Task['status']['state']>([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

function resolveRequiredJsonRpcTenant(agentCard: AgentCard): string | undefined {
  const supportedInterfaces = (
    agentCard as AgentCard & {
      supportedInterfaces?: Array<{
        protocolBinding?: string;
        tenant?: string;
      }>;
    }
  ).supportedInterfaces;

  return supportedInterfaces?.find((entry) => entry.protocolBinding === 'JSONRPC')?.tenant;
}

function applyHistoryLength(task: Task, historyLength: number | undefined): Task {
  const normalized = { ...task };

  if (historyLength === undefined) {
    return normalized;
  }

  if (historyLength === 0) {
    delete normalized.history;
    return normalized;
  }

  if (historyLength > 0 && normalized.history) {
    normalized.history = normalized.history.slice(-historyLength);
  }

  return normalized;
}

function supportsExtendedAgentCard(agentCard: AgentCard): boolean {
  const capabilities = agentCard.capabilities as AgentCapabilitiesWithExtendedCard | undefined;
  return (
    capabilities?.extendedAgentCard === true || agentCard.supportsAuthenticatedExtendedCard === true
  );
}

function supportsPushNotifications(agentCard: AgentCard): boolean {
  return agentCard.capabilities.pushNotifications === true;
}

function supportsExtendedAgentCardForA2AVersion(agentCard: AgentCard, version: string): boolean {
  const capabilities = agentCard.capabilities as AgentCapabilitiesWithExtendedCard | undefined;
  if (version === '1.0') {
    return capabilities?.extendedAgentCard === true;
  }
  return supportsExtendedAgentCard(agentCard);
}

function readRequestedA2AVersion(req: Parameters<RequestHandler>[0]): string {
  const headerVersion = req.header('A2A-Version');
  if (headerVersion && headerVersion.trim().length > 0) {
    return headerVersion.trim();
  }

  const queryVersion = req.query['A2A-Version'] ?? req.query['a2a-version'];
  if (typeof queryVersion === 'string' && queryVersion.trim().length > 0) {
    return queryVersion.trim();
  }

  return '0.3';
}

function readRequestedExtensions(req: Parameters<RequestHandler>[0]): Set<string> {
  const rawHeader =
    req.header(OFFICIAL_A2A_EXTENSIONS_HEADER) ?? req.header(LEGACY_A2A_EXTENSIONS_HEADER);
  if (!rawHeader) {
    return new Set();
  }

  return new Set(
    rawHeader
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function createJsonRpcErrorResponse(
  requestId: unknown,
  error: { code: number; message: string },
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id:
      typeof requestId === 'string' ||
      (typeof requestId === 'number' && Number.isInteger(requestId))
        ? requestId
        : null,
    error,
  };
}

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return String(value);
}

function stripTenantFromParams(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return params;
  }

  const { tenant: _tenant, ...rest } = params as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function normalizeSendMessageParamsForV1(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return params;
  }

  const rawParams = params as Record<string, unknown>;
  const rawConfiguration = rawParams.configuration;
  if (
    typeof rawConfiguration !== 'object' ||
    rawConfiguration === null ||
    Array.isArray(rawConfiguration)
  ) {
    return params;
  }

  const configuration = rawConfiguration as Record<string, unknown>;
  const hasTaskPushNotificationConfig = 'taskPushNotificationConfig' in configuration;
  const hasReturnImmediately = 'returnImmediately' in configuration;
  if (!hasTaskPushNotificationConfig && !hasReturnImmediately) {
    return params;
  }

  const normalizedPushNotificationConfig = (() => {
    if (configuration.pushNotificationConfig !== undefined) {
      return configuration.pushNotificationConfig;
    }

    const taskPushNotificationConfig = configuration.taskPushNotificationConfig;
    if (
      typeof taskPushNotificationConfig !== 'object' ||
      taskPushNotificationConfig === null ||
      Array.isArray(taskPushNotificationConfig)
    ) {
      return taskPushNotificationConfig;
    }

    const {
      taskId: _taskId,
      tenant: _tenant,
      ...rest
    } = taskPushNotificationConfig as Record<string, unknown>;
    const rawAuthentication = rest.authentication;
    const normalizedAuthentication =
      typeof rawAuthentication === 'object' &&
      rawAuthentication !== null &&
      !Array.isArray(rawAuthentication) &&
      'scheme' in rawAuthentication &&
      !('schemes' in rawAuthentication)
        ? {
            schemes: [(rawAuthentication as { scheme: unknown }).scheme],
            credentials: (() => {
              const credentials = (rawAuthentication as { credentials?: unknown }).credentials;
              return typeof credentials === 'string' ? credentials : '';
            })(),
          }
        : rawAuthentication;

    return {
      ...rest,
      authentication: normalizedAuthentication,
    };
  })();

  const {
    taskPushNotificationConfig: _taskPushNotificationConfig,
    returnImmediately: rawReturnImmediately,
    ...restConfiguration
  } = configuration;

  const normalizedBlocking =
    typeof rawReturnImmediately === 'boolean' && restConfiguration.blocking === undefined
      ? !rawReturnImmediately
      : restConfiguration.blocking;

  return {
    ...rawParams,
    configuration: {
      ...restConfiguration,
      ...(normalizedBlocking !== undefined ? { blocking: normalizedBlocking } : {}),
      pushNotificationConfig: normalizedPushNotificationConfig,
    },
  };
}

function hasListableTaskStore(store: TaskStore): store is ListableTaskStore {
  return typeof (store as Partial<ListableTaskStore>).listTasks === 'function';
}

function isRfc3339Timestamp(value: string): boolean {
  const match = value.match(RFC3339_TIMESTAMP_PATTERN);
  if (!match) {
    return false;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    _fraction,
    _sign,
    offsetHourText,
    offsetMinuteText,
  ] = match;

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) {
    return false;
  }

  if (offsetHourText !== undefined && offsetMinuteText !== undefined) {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

function parseListTasksParams(rawParams: unknown): {
  contextId?: string;
  status?: Task['status']['state'];
  pageSize: number;
  pageToken?: string;
  historyLength?: number;
  statusTimestampAfter?: string;
  includeArtifacts: boolean;
} {
  const params = (rawParams ?? {}) as ListTasksParams;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw A2AError.invalidParams('ListTasks params must be an object.');
  }

  if (params.tenant !== undefined && typeof params.tenant !== 'string') {
    throw A2AError.invalidParams('ListTasks tenant must be a string.');
  }
  if (params.contextId !== undefined && typeof params.contextId !== 'string') {
    throw A2AError.invalidParams('ListTasks contextId must be a string.');
  }
  if (params.pageToken !== undefined && typeof params.pageToken !== 'string') {
    throw A2AError.invalidParams('ListTasks pageToken must be a string.');
  }
  if (params.pageSize !== undefined && !Number.isInteger(params.pageSize)) {
    throw A2AError.invalidParams('ListTasks pageSize must be an integer.');
  }
  if (params.pageSize !== undefined && (params.pageSize < 1 || params.pageSize > 100)) {
    throw A2AError.invalidParams(
      `ListTasks pageSize must be between 1 and ${MAX_LIST_TASKS_PAGE_SIZE}.`,
    );
  }
  if (params.historyLength !== undefined && !Number.isInteger(params.historyLength)) {
    throw A2AError.invalidParams('ListTasks historyLength must be an integer.');
  }
  if (params.historyLength !== undefined && params.historyLength < 0) {
    throw A2AError.invalidParams('ListTasks historyLength must be greater than or equal to 0.');
  }
  if (params.statusTimestampAfter !== undefined) {
    if (typeof params.statusTimestampAfter !== 'string') {
      throw A2AError.invalidParams('ListTasks statusTimestampAfter must be an ISO 8601 string.');
    }
    if (!isRfc3339Timestamp(params.statusTimestampAfter)) {
      throw A2AError.invalidParams('ListTasks statusTimestampAfter must be a valid timestamp.');
    }
  }
  if (params.includeArtifacts !== undefined && typeof params.includeArtifacts !== 'boolean') {
    throw A2AError.invalidParams('ListTasks includeArtifacts must be a boolean.');
  }

  let status: Task['status']['state'] | undefined;
  if (params.status !== undefined) {
    if (typeof params.status !== 'string') {
      throw A2AError.invalidParams('ListTasks status must be a string enum value.');
    }
    if (!(params.status in TASK_STATE_FILTERS)) {
      throw A2AError.invalidParams(`Unsupported ListTasks status: ${params.status}`);
    }
    status = TASK_STATE_FILTERS[params.status];
  }

  return {
    contextId: params.contextId,
    status,
    pageSize: params.pageSize ?? DEFAULT_LIST_TASKS_PAGE_SIZE,
    pageToken: params.pageToken,
    historyLength: params.historyLength,
    statusTimestampAfter: params.statusTimestampAfter,
    includeArtifacts: params.includeArtifacts ?? false,
  };
}

function normalizeListedTask(
  task: Task,
  options: { historyLength?: number; includeArtifacts: boolean },
): Task {
  const normalized = structuredClone(task);
  const withHistory = applyHistoryLength(normalized, options.historyLength);
  if (!options.includeArtifacts) {
    delete withHistory.artifacts;
  }
  return withHistory;
}

const normalizeA2AExtensionHeadersByVersion: RequestHandler = (req, res, next) => {
  const requestedVersion = readRequestedA2AVersion(req);
  const officialExtensions = req.header(OFFICIAL_A2A_EXTENSIONS_HEADER);
  if (officialExtensions && !req.header(LEGACY_A2A_EXTENSIONS_HEADER)) {
    req.headers['x-a2a-extensions'] = officialExtensions;
  }

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: unknown) => {
    if (
      requestedVersion === '1.0' &&
      typeof name === 'string' &&
      name.toLowerCase() === LEGACY_A2A_EXTENSIONS_HEADER.toLowerCase()
    ) {
      return originalSetHeader(OFFICIAL_A2A_EXTENSIONS_HEADER, normalizeHeaderValue(value));
    }

    return originalSetHeader(name, value as Parameters<typeof originalSetHeader>[1]);
  }) as typeof res.setHeader;

  next();
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeTask(result: Record<string, unknown>): boolean {
  return typeof result.id === 'string' && 'status' in result;
}

function looksLikeMessage(result: Record<string, unknown>): boolean {
  return typeof result.messageId === 'string' && 'role' in result;
}

function looksLikeStatusUpdate(result: Record<string, unknown>): boolean {
  return (
    typeof result.taskId === 'string' && typeof result.contextId === 'string' && 'status' in result
  );
}

function looksLikeArtifactUpdate(result: Record<string, unknown>): boolean {
  return (
    typeof result.taskId === 'string' &&
    typeof result.contextId === 'string' &&
    'artifact' in result
  );
}

function normalizeTaskStateForV1(state: unknown): unknown {
  switch (state) {
    case 'unknown':
      return 'TASK_STATE_UNSPECIFIED';
    case 'submitted':
      return 'TASK_STATE_SUBMITTED';
    case 'working':
      return 'TASK_STATE_WORKING';
    case 'completed':
      return 'TASK_STATE_COMPLETED';
    case 'failed':
      return 'TASK_STATE_FAILED';
    case 'canceled':
    case 'cancelled':
      return 'TASK_STATE_CANCELED';
    case 'input-required':
      return 'TASK_STATE_INPUT_REQUIRED';
    case 'rejected':
      return 'TASK_STATE_REJECTED';
    case 'auth-required':
      return 'TASK_STATE_AUTH_REQUIRED';
    default:
      return state;
  }
}

function normalizeRoleForV1(role: unknown): unknown {
  switch (role) {
    case 'user':
      return 'ROLE_USER';
    case 'agent':
      return 'ROLE_AGENT';
    default:
      return role;
  }
}

function normalizePartForV1(part: unknown): unknown {
  if (!isObjectRecord(part)) {
    return part;
  }

  if ('kind' in part) {
    if (part.kind === 'text') {
      const normalized: Record<string, unknown> = {};
      if (part.text !== undefined) {
        normalized.text = part.text;
      }
      return normalized;
    }

    if (part.kind === 'data') {
      const normalized: Record<string, unknown> = {};
      if (part.data !== undefined) {
        normalized.data = part.data;
      }
      return normalized;
    }

    if (part.kind === 'file' && isObjectRecord(part.file)) {
      const normalized: Record<string, unknown> = {};
      if (part.file.uri !== undefined) {
        normalized.url = part.file.uri;
      }
      if (part.file.bytes !== undefined) {
        normalized.raw = Buffer.isBuffer(part.file.bytes)
          ? part.file.bytes.toString('base64')
          : part.file.bytes;
      }
      if (part.file.name !== undefined) {
        normalized.filename = part.file.name;
      }
      if (part.file.mimeType !== undefined) {
        normalized.mediaType = part.file.mimeType;
      }
      return normalized;
    }
  }

  return part;
}

function normalizeMessageForV1(message: unknown): unknown {
  if (!isObjectRecord(message)) {
    return message;
  }

  const normalized: Record<string, unknown> = {};
  if (message.messageId !== undefined) {
    normalized.messageId = message.messageId;
  }
  if (message.contextId !== undefined) {
    normalized.contextId = message.contextId;
  }
  if (message.taskId !== undefined) {
    normalized.taskId = message.taskId;
  }
  if (message.role !== undefined) {
    normalized.role = normalizeRoleForV1(message.role);
  }

  const rawParts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : undefined;
  if (rawParts) {
    normalized.parts = rawParts.map((part) => normalizePartForV1(part));
  }

  if (message.metadata !== undefined) {
    normalized.metadata = message.metadata;
  }
  if (message.extensions !== undefined) {
    normalized.extensions = message.extensions;
  }
  if (message.referenceTaskIds !== undefined) {
    normalized.referenceTaskIds = message.referenceTaskIds;
  }

  return normalized;
}

function normalizeArtifactForV1(artifact: unknown): unknown {
  if (!isObjectRecord(artifact)) {
    return artifact;
  }

  const normalized: Record<string, unknown> = {};
  if (artifact.artifactId !== undefined) {
    normalized.artifactId = artifact.artifactId;
  }
  if (artifact.name !== undefined) {
    normalized.name = artifact.name;
  }
  if (artifact.description !== undefined) {
    normalized.description = artifact.description;
  }
  if (Array.isArray(artifact.parts)) {
    normalized.parts = artifact.parts.map((part) => normalizePartForV1(part));
  }
  if (artifact.metadata !== undefined) {
    normalized.metadata = artifact.metadata;
  }
  if (artifact.extensions !== undefined) {
    normalized.extensions = artifact.extensions;
  }

  return normalized;
}

function normalizeTaskStatusForV1(status: unknown): unknown {
  if (!isObjectRecord(status)) {
    return status;
  }

  const normalized: Record<string, unknown> = {};
  if (status.state !== undefined) {
    normalized.state = normalizeTaskStateForV1(status.state);
  }
  const statusMessage = status.message ?? status.update;
  if (statusMessage !== undefined) {
    normalized.message = normalizeMessageForV1(statusMessage);
  }
  if (status.timestamp !== undefined) {
    normalized.timestamp = status.timestamp;
  }

  return normalized;
}

function normalizeTaskForV1(task: unknown): unknown {
  if (!isObjectRecord(task)) {
    return task;
  }

  const normalized: Record<string, unknown> = {};
  if (task.id !== undefined) {
    normalized.id = task.id;
  }
  if (task.contextId !== undefined) {
    normalized.contextId = task.contextId;
  }
  if (task.status !== undefined) {
    normalized.status = normalizeTaskStatusForV1(task.status);
  }
  if (Array.isArray(task.artifacts)) {
    normalized.artifacts = task.artifacts.map((artifact) => normalizeArtifactForV1(artifact));
  }
  if (Array.isArray(task.history)) {
    normalized.history = task.history.map((message) => normalizeMessageForV1(message));
  }
  if (task.metadata !== undefined) {
    normalized.metadata = task.metadata;
  }

  return normalized;
}

function normalizeListTasksResultForV1(result: unknown): unknown {
  if (!isObjectRecord(result)) {
    return result;
  }

  const normalized: Record<string, unknown> = { ...result };
  if (Array.isArray(result.tasks)) {
    normalized.tasks = result.tasks.map((task) => normalizeTaskForV1(task));
  }
  return normalized;
}

function normalizeAgentCardForV1(card: unknown): unknown {
  if (!isObjectRecord(card)) {
    return card;
  }

  const normalized: Record<string, unknown> = { ...card };

  const supportedInterfaces = Array.isArray(card.supportedInterfaces)
    ? card.supportedInterfaces
    : undefined;
  if (supportedInterfaces === undefined) {
    const synthesizedInterfaces: Array<Record<string, unknown>> = [];
    if (typeof card.url === 'string') {
      synthesizedInterfaces.push({
        url: card.url,
        protocolBinding:
          typeof card.preferredTransport === 'string' ? card.preferredTransport : 'JSONRPC',
        protocolVersion: '1.0',
      });
    }
    if (Array.isArray(card.additionalInterfaces)) {
      for (const entry of card.additionalInterfaces) {
        if (!isObjectRecord(entry) || typeof entry.url !== 'string') {
          continue;
        }
        synthesizedInterfaces.push({
          url: entry.url,
          protocolBinding: typeof entry.transport === 'string' ? entry.transport : 'JSONRPC',
          protocolVersion: '1.0',
        });
      }
    }
    if (synthesizedInterfaces.length > 0) {
      normalized.supportedInterfaces = synthesizedInterfaces;
    }
  }

  if (normalized.securityRequirements === undefined && Array.isArray(card.security)) {
    normalized.securityRequirements = card.security;
  }

  delete normalized.url;
  delete normalized.protocolVersion;
  delete normalized.preferredTransport;
  delete normalized.additionalInterfaces;
  delete normalized.security;
  delete normalized.supportsAuthenticatedExtendedCard;

  if (isObjectRecord(normalized.capabilities)) {
    const capabilities = normalized.capabilities;
    const nextCapabilities = { ...capabilities };
    if (
      card.supportsAuthenticatedExtendedCard === true &&
      nextCapabilities.extendedAgentCard !== true
    ) {
      nextCapabilities.extendedAgentCard = true;
    }
    if ('stateTransitionHistory' in nextCapabilities) {
      const { stateTransitionHistory: _stateTransitionHistory, ...restCapabilities } =
        nextCapabilities;
      normalized.capabilities = restCapabilities;
    } else {
      normalized.capabilities = nextCapabilities;
    }
  } else if (card.supportsAuthenticatedExtendedCard === true) {
    normalized.capabilities = { extendedAgentCard: true };
  }

  if (Array.isArray(card.skills)) {
    normalized.skills = card.skills.map((skill) => {
      if (!isObjectRecord(skill)) {
        return skill;
      }

      const normalizedSkill: Record<string, unknown> = { ...skill };
      if (normalizedSkill.securityRequirements === undefined && Array.isArray(skill.security)) {
        normalizedSkill.securityRequirements = skill.security;
      }
      delete normalizedSkill.security;
      return normalizedSkill;
    });
  }

  return normalized;
}

function normalizeStatusUpdateForV1(result: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  if (result.taskId !== undefined) {
    normalized.taskId = result.taskId;
  }
  if (result.contextId !== undefined) {
    normalized.contextId = result.contextId;
  }
  if (result.status !== undefined) {
    normalized.status = normalizeTaskStatusForV1(result.status);
  }
  if (result.metadata !== undefined) {
    normalized.metadata = result.metadata;
  }
  return normalized;
}

function normalizeArtifactUpdateForV1(result: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  if (result.taskId !== undefined) {
    normalized.taskId = result.taskId;
  }
  if (result.contextId !== undefined) {
    normalized.contextId = result.contextId;
  }
  if (result.artifact !== undefined) {
    normalized.artifact = normalizeArtifactForV1(result.artifact);
  }
  if (result.append !== undefined) {
    normalized.append = result.append;
  }
  if (result.lastChunk !== undefined) {
    normalized.lastChunk = result.lastChunk;
  }
  if (result.metadata !== undefined) {
    normalized.metadata = result.metadata;
  }
  return normalized;
}

function stripLegacyStatusUpdateFields(result: Record<string, unknown>): Record<string, unknown> {
  if (!('final' in result)) {
    return result;
  }

  const { final: _final, ...rest } = result;
  return rest;
}

function wrapSendMessageResult(result: unknown): unknown {
  if (!isObjectRecord(result)) {
    return result;
  }

  if ('task' in result || 'message' in result) {
    return {
      ...(result.task !== undefined ? { task: normalizeTaskForV1(result.task) } : {}),
      ...(result.message !== undefined ? { message: normalizeMessageForV1(result.message) } : {}),
    };
  }

  if (looksLikeTask(result)) {
    return { task: normalizeTaskForV1(result) };
  }

  if (looksLikeMessage(result)) {
    return { message: normalizeMessageForV1(result) };
  }

  return result;
}

function wrapStreamResponseResult(result: unknown): unknown {
  if (!isObjectRecord(result)) {
    return result;
  }

  if (
    'task' in result ||
    'message' in result ||
    'statusUpdate' in result ||
    'artifactUpdate' in result
  ) {
    if (isObjectRecord(result.statusUpdate)) {
      return {
        ...result,
        statusUpdate: normalizeStatusUpdateForV1(
          stripLegacyStatusUpdateFields(result.statusUpdate),
        ),
      };
    }
    if (isObjectRecord(result.task)) {
      return { ...result, task: normalizeTaskForV1(result.task) };
    }
    if (isObjectRecord(result.message)) {
      return { ...result, message: normalizeMessageForV1(result.message) };
    }
    if (isObjectRecord(result.artifactUpdate)) {
      return { ...result, artifactUpdate: normalizeArtifactUpdateForV1(result.artifactUpdate) };
    }
    return result;
  }

  if (looksLikeTask(result)) {
    return { task: normalizeTaskForV1(result) };
  }

  if (looksLikeMessage(result)) {
    return { message: normalizeMessageForV1(result) };
  }

  if (looksLikeStatusUpdate(result)) {
    return { statusUpdate: normalizeStatusUpdateForV1(stripLegacyStatusUpdateFields(result)) };
  }

  if (looksLikeArtifactUpdate(result)) {
    return { artifactUpdate: normalizeArtifactUpdateForV1(result) };
  }

  return result;
}

function normalizeJsonRpcResultByMethod(method: string, result: unknown): unknown {
  if (method === 'message/send') {
    return wrapSendMessageResult(result);
  }

  if (method === 'tasks/get' || method === 'tasks/cancel') {
    return normalizeTaskForV1(result);
  }

  if (method === 'ListTasks') {
    return normalizeListTasksResultForV1(result);
  }

  if (method === 'agent/getAuthenticatedExtendedCard') {
    return normalizeAgentCardForV1(result);
  }

  if (method === 'message/stream' || method === 'tasks/resubscribe') {
    return wrapStreamResponseResult(result);
  }

  return result;
}

function normalizeJsonRpcPayloadByMethod(method: string, payload: unknown): unknown {
  if (!isObjectRecord(payload) || !('result' in payload)) {
    return payload;
  }

  return {
    ...payload,
    result: normalizeJsonRpcResultByMethod(method, payload.result),
  };
}

function normalizeSseJsonRpcChunkByMethod(chunk: string, method: string): string {
  return chunk
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data: ')) {
        return line;
      }

      try {
        const payload = JSON.parse(line.slice('data: '.length));
        return `data: ${JSON.stringify(normalizeJsonRpcPayloadByMethod(method, payload))}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

const normalizeJsonRpcResponsesByVersion: RequestHandler = (req, res, next) => {
  if (readRequestedA2AVersion(req) !== '1.0') {
    next();
    return;
  }

  const method = typeof req.body?.method === 'string' ? req.body.method : '';
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: unknown) => {
    if (
      typeof name === 'string' &&
      name.toLowerCase() === 'content-type' &&
      typeof value === 'string' &&
      /^application\/json\b/i.test(value)
    ) {
      return originalSetHeader(
        'Content-Type',
        value.replace(/^application\/json/i, 'application/a2a+json'),
      );
    }

    return originalSetHeader(name, value as Parameters<typeof originalSetHeader>[1]);
  }) as typeof res.setHeader;

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) =>
    originalJson(normalizeJsonRpcPayloadByMethod(method, body))) as typeof res.json;

  const originalWrite = res.write.bind(res);
  res.write = ((...writeArgs: Parameters<typeof res.write>) => {
    const [chunk, second, third] = writeArgs;

    if (typeof chunk === 'string') {
      return originalWrite(normalizeSseJsonRpcChunkByMethod(chunk, method), second, third);
    }

    if (Buffer.isBuffer(chunk)) {
      return originalWrite(
        Buffer.from(normalizeSseJsonRpcChunkByMethod(chunk.toString('utf8'), method)),
        second,
        third,
      );
    }

    return originalWrite(chunk, second, third);
  }) as typeof res.write;

  next();
};

const normalizeJsonRpcRequestByVersion: RequestHandler = (req, res, next) => {
  if (
    req.method === 'POST' &&
    typeof req.body === 'object' &&
    req.body !== null &&
    typeof req.body.method === 'string'
  ) {
    const requestedVersion = readRequestedA2AVersion(req);
    if (!SUPPORTED_A2A_VERSIONS.has(requestedVersion)) {
      res.status(200).json(
        createJsonRpcErrorResponse(req.body.id, {
          code: -32009,
          message: `A2A protocol version ${requestedVersion} is not supported.`,
        }),
      );
      return;
    }

    if (requestedVersion === '1.0') {
      if (LEGACY_JSON_RPC_METHODS.has(req.body.method)) {
        res.status(200).json(
          createJsonRpcErrorResponse(req.body.id, {
            code: -32601,
            message: `Method not found: ${req.body.method}`,
          }),
        );
        return;
      }
      req.body.method = JSON_RPC_METHOD_ALIASES[req.body.method] ?? req.body.method;
      if (req.body.method === 'message/send' || req.body.method === 'message/stream') {
        req.body.params = normalizeSendMessageParamsForV1(req.body.params);
      }
    }
  }

  next();
};

function createTenantValidationHandler(agentCard: AgentCard): RequestHandler {
  const requiredTenant = resolveRequiredJsonRpcTenant(agentCard);

  return (req, res, next) => {
    if (
      !requiredTenant ||
      req.method !== 'POST' ||
      typeof req.body !== 'object' ||
      req.body === null ||
      typeof req.body.method !== 'string'
    ) {
      next();
      return;
    }

    const requestedVersion = readRequestedA2AVersion(req);
    if (requestedVersion !== '1.0') {
      next();
      return;
    }

    const rawParams = req.body.params;
    if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
      res.status(200).json(
        createJsonRpcErrorResponse(req.body.id, {
          code: A2AError.invalidParams(
            `tenant must be exactly "${requiredTenant}" for this agent interface.`,
          ).code,
          message: `Invalid params: tenant must be exactly "${requiredTenant}" for this agent interface.`,
        }),
      );
      return;
    }

    if (rawParams.tenant !== requiredTenant) {
      res.status(200).json(
        createJsonRpcErrorResponse(req.body.id, {
          code: A2AError.invalidParams(
            `tenant must be exactly "${requiredTenant}" for this agent interface.`,
          ).code,
          message: `Invalid params: tenant must be exactly "${requiredTenant}" for this agent interface.`,
        }),
      );
      return;
    }

    req.body.params = stripTenantFromParams(rawParams);
    next();
  };
}

function createListTasksHandler(taskStore: TaskStore): RequestHandler {
  return async (req, res, next) => {
    if (
      req.method !== 'POST' ||
      typeof req.body !== 'object' ||
      req.body === null ||
      req.body.method !== 'ListTasks'
    ) {
      next();
      return;
    }

    const requestedVersion = readRequestedA2AVersion(req);
    if (requestedVersion !== '1.0') {
      next();
      return;
    }

    if (!hasListableTaskStore(taskStore)) {
      res.status(200).json(
        createJsonRpcErrorResponse(req.body.id, {
          code: A2AError.methodNotFound('ListTasks').code,
          message: A2AError.methodNotFound('ListTasks').message,
        }),
      );
      return;
    }

    try {
      const parsed = parseListTasksParams(req.body.params);
      const result = await taskStore.listTasks({
        contextId: parsed.contextId,
        status: parsed.status,
        pageSize: parsed.pageSize,
        pageToken: parsed.pageToken,
        statusTimestampAfter: parsed.statusTimestampAfter,
      });

      res.status(200).json({
        jsonrpc: '2.0',
        id:
          typeof req.body.id === 'string' ||
          (typeof req.body.id === 'number' && Number.isInteger(req.body.id))
            ? req.body.id
            : null,
        result: {
          tasks: result.tasks.map((task) =>
            normalizeListedTask(task, {
              historyLength: parsed.historyLength,
              includeArtifacts: parsed.includeArtifacts,
            }),
          ),
          nextPageToken: result.nextPageToken,
          pageSize: result.pageSize,
          totalSize: result.totalSize,
        },
      });
    } catch (error) {
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.internalError(error instanceof Error ? error.message : 'ListTasks failed.');
      res.status(200).json(createJsonRpcErrorResponse(req.body.id, a2aError.toJSONRPCError()));
    }
  };
}

function createExtendedAgentCardCapabilityValidationHandler(agentCard: AgentCard): RequestHandler {
  return (req, res, next) => {
    if (
      req.method !== 'POST' ||
      typeof req.body !== 'object' ||
      req.body === null ||
      req.body.method !== 'agent/getAuthenticatedExtendedCard'
    ) {
      next();
      return;
    }

    const requestedVersion = readRequestedA2AVersion(req);
    if (supportsExtendedAgentCardForA2AVersion(agentCard, requestedVersion)) {
      next();
      return;
    }

    const error = A2AError.unsupportedOperation(
      'Agent does not support authenticated extended card.',
    );
    res.status(200).json(createJsonRpcErrorResponse(req.body.id, error.toJSONRPCError()));
  };
}

function createRequiredExtensionsValidationHandler(agentCard: AgentCard): RequestHandler {
  const capabilities = agentCard.capabilities as AgentCapabilitiesWithExtendedCard | undefined;
  const requiredExtensions =
    capabilities?.extensions
      ?.filter(
        (extension): extension is { uri: string; required: true } =>
          extension?.required === true &&
          typeof extension.uri === 'string' &&
          extension.uri.length > 0,
      )
      .map((extension) => extension.uri) ?? [];

  return (req, res, next) => {
    if (
      requiredExtensions.length === 0 ||
      req.method !== 'POST' ||
      typeof req.body !== 'object' ||
      req.body === null ||
      typeof req.body.method !== 'string'
    ) {
      next();
      return;
    }

    if (readRequestedA2AVersion(req) !== '1.0') {
      next();
      return;
    }

    const requestedExtensions = readRequestedExtensions(req);
    const missingExtension = requiredExtensions.find((uri) => !requestedExtensions.has(uri));
    if (!missingExtension) {
      next();
      return;
    }

    const error = new A2AError(-32008, `Extension support required: ${missingExtension}`);
    res.status(200).json(createJsonRpcErrorResponse(req.body.id, error.toJSONRPCError()));
  };
}

function createTerminalResubscribeValidationHandler(taskStore: TaskStore): RequestHandler {
  return async (req, res, next) => {
    if (
      req.method !== 'POST' ||
      typeof req.body !== 'object' ||
      req.body === null ||
      req.body.method !== 'tasks/resubscribe'
    ) {
      next();
      return;
    }

    const requestedVersion = readRequestedA2AVersion(req);
    if (requestedVersion !== '1.0') {
      next();
      return;
    }

    const params = req.body.params;
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      next();
      return;
    }

    const taskId = params.id;
    if (typeof taskId !== 'string') {
      next();
      return;
    }

    const task = await taskStore.load(taskId);
    if (!task || !TERMINAL_TASK_STATES.has(task.status.state)) {
      next();
      return;
    }

    const error = A2AError.unsupportedOperation(
      'SubscribeToTask is not available for terminal tasks.',
    );
    res.status(200).json(createJsonRpcErrorResponse(req.body.id, error.toJSONRPCError()));
  };
}

function createPushNotificationConfigHandler(
  agentCard: AgentCard,
  taskStore: TaskStore,
  pushNotificationStore: PushNotificationStore | undefined,
): RequestHandler {
  return async (req, res, next) => {
    if (
      req.method !== 'POST' ||
      typeof req.body !== 'object' ||
      req.body === null ||
      typeof req.body.method !== 'string'
    ) {
      next();
      return;
    }

    const requestedVersion = readRequestedA2AVersion(req);
    if (requestedVersion !== '1.0') {
      next();
      return;
    }

    const method = req.body.method;
    if (
      method !== 'tasks/pushNotificationConfig/set' &&
      method !== 'tasks/pushNotificationConfig/get' &&
      method !== 'tasks/pushNotificationConfig/list' &&
      method !== 'tasks/pushNotificationConfig/delete'
    ) {
      next();
      return;
    }

    if (!supportsPushNotifications(agentCard)) {
      const error = A2AError.pushNotificationNotSupported();
      res.status(200).json(createJsonRpcErrorResponse(req.body.id, error.toJSONRPCError()));
      return;
    }

    if (!pushNotificationStore) {
      const error = A2AError.internalError('Push notification store is not configured.');
      res.status(200).json(createJsonRpcErrorResponse(req.body.id, error.toJSONRPCError()));
      return;
    }

    try {
      if (method === 'tasks/pushNotificationConfig/set') {
        const config = parsePushNotificationConfigParams(req.body.params);
        const task = await taskStore.load(config.taskId);
        if (!task) {
          throw A2AError.taskNotFound(config.taskId);
        }

        const storedConfig = toStoredPushNotificationConfig(config);
        await pushNotificationStore.save(config.taskId, storedConfig);
        res.status(200).json({
          jsonrpc: '2.0',
          id:
            typeof req.body.id === 'string' ||
            (typeof req.body.id === 'number' && Number.isInteger(req.body.id))
              ? req.body.id
              : null,
          result: toExternalPushNotificationConfig(config.taskId, storedConfig),
        });
        return;
      }

      if (method === 'tasks/pushNotificationConfig/get') {
        const params = parsePushNotificationConfigLookupParams(req.body.params);
        const task = await taskStore.load(params.taskId);
        if (!task) {
          throw A2AError.taskNotFound(params.taskId);
        }

        const configs = await pushNotificationStore.load(params.taskId);
        const config = configs.find((entry) => entry.id === params.id);
        if (!config) {
          throw A2AError.taskNotFound(params.taskId);
        }

        res.status(200).json({
          jsonrpc: '2.0',
          id:
            typeof req.body.id === 'string' ||
            (typeof req.body.id === 'number' && Number.isInteger(req.body.id))
              ? req.body.id
              : null,
          result: toExternalPushNotificationConfig(params.taskId, config),
        });
        return;
      }

      if (method === 'tasks/pushNotificationConfig/list') {
        const params = parseListPushNotificationConfigsParams(req.body.params);
        const task = await taskStore.load(params.taskId);
        if (!task) {
          throw A2AError.taskNotFound(params.taskId);
        }

        let configs = await pushNotificationStore.load(params.taskId);
        const pageSize = params.pageSize ?? configs.length;
        if (params.pageToken) {
          const cursorIndex = configs.findIndex((entry) => entry.id === params.pageToken);
          if (cursorIndex < 0) {
            throw A2AError.invalidParams(`Unknown pageToken: ${params.pageToken}`);
          }
          configs = configs.slice(cursorIndex + 1);
        }

        const pageConfigs = configs.slice(0, pageSize);
        const nextPageToken =
          configs.length > pageConfigs.length && pageConfigs.length > 0
            ? (pageConfigs[pageConfigs.length - 1]?.id ?? '')
            : '';

        res.status(200).json({
          jsonrpc: '2.0',
          id:
            typeof req.body.id === 'string' ||
            (typeof req.body.id === 'number' && Number.isInteger(req.body.id))
              ? req.body.id
              : null,
          result: {
            configs: pageConfigs.map((config) =>
              toExternalPushNotificationConfig(params.taskId, config),
            ),
            nextPageToken,
          },
        });
        return;
      }

      const params = parsePushNotificationConfigLookupParams(req.body.params);
      const task = await taskStore.load(params.taskId);
      if (!task) {
        throw A2AError.taskNotFound(params.taskId);
      }

      await pushNotificationStore.delete(params.taskId, params.id);
      res.status(200).json({
        jsonrpc: '2.0',
        id:
          typeof req.body.id === 'string' ||
          (typeof req.body.id === 'number' && Number.isInteger(req.body.id))
            ? req.body.id
            : null,
        result: {},
      });
    } catch (error) {
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.internalError(
              error instanceof Error ? error.message : 'Push notification config handling failed.',
            );
      res.status(200).json(createJsonRpcErrorResponse(req.body.id, a2aError.toJSONRPCError()));
    }
  };
}

function parsePushNotificationConfigParams(rawParams: unknown): ParsedPushNotificationConfigParams {
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    throw A2AError.invalidParams('Push notification config params must be an object.');
  }

  const params = rawParams as PushNotificationConfigParams;
  if (!params.taskId || typeof params.taskId !== 'string') {
    throw A2AError.invalidParams('Push notification config taskId must be a string.');
  }
  if (params.id !== undefined && typeof params.id !== 'string') {
    throw A2AError.invalidParams('Push notification config id must be a string.');
  }
  if (!params.url || typeof params.url !== 'string') {
    throw A2AError.invalidParams('Push notification config url must be a string.');
  }
  if (params.token !== undefined && typeof params.token !== 'string') {
    throw A2AError.invalidParams('Push notification config token must be a string.');
  }
  if (
    params.authentication !== undefined &&
    (typeof params.authentication !== 'object' ||
      params.authentication === null ||
      Array.isArray(params.authentication) ||
      typeof params.authentication.scheme !== 'string' ||
      (params.authentication.credentials !== undefined &&
        typeof params.authentication.credentials !== 'string'))
  ) {
    throw A2AError.invalidParams(
      'Push notification config authentication must be an object with a string scheme.',
    );
  }

  return {
    taskId: params.taskId,
    id: params.id ?? params.taskId,
    url: params.url,
    token: params.token,
    authentication: params.authentication,
  };
}

function parsePushNotificationConfigLookupParams(
  rawParams: unknown,
): Required<PushNotificationConfigLookupParams> {
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    throw A2AError.invalidParams('Push notification config lookup params must be an object.');
  }

  const params = rawParams as PushNotificationConfigLookupParams;
  if (!params.taskId || typeof params.taskId !== 'string') {
    throw A2AError.invalidParams('Push notification config taskId must be a string.');
  }
  if (!params.id || typeof params.id !== 'string') {
    throw A2AError.invalidParams('Push notification config id must be a string.');
  }

  return {
    taskId: params.taskId,
    id: params.id,
  };
}

function parseListPushNotificationConfigsParams(rawParams: unknown): {
  taskId: string;
  pageSize?: number;
  pageToken?: string;
} {
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    throw A2AError.invalidParams('ListTaskPushNotificationConfigs params must be an object.');
  }

  const params = rawParams as ListPushNotificationConfigsParams;
  if (!params.taskId || typeof params.taskId !== 'string') {
    throw A2AError.invalidParams('ListTaskPushNotificationConfigs taskId must be a string.');
  }
  if (
    params.pageSize !== undefined &&
    (!Number.isInteger(params.pageSize) || params.pageSize < 1)
  ) {
    throw A2AError.invalidParams(
      'ListTaskPushNotificationConfigs pageSize must be a positive integer.',
    );
  }
  if (params.pageToken !== undefined && typeof params.pageToken !== 'string') {
    throw A2AError.invalidParams('ListTaskPushNotificationConfigs pageToken must be a string.');
  }

  return {
    taskId: params.taskId,
    pageSize: params.pageSize,
    pageToken: params.pageToken,
  };
}

function toStoredPushNotificationConfig(
  config: ParsedPushNotificationConfigParams,
): PushNotificationConfig {
  const authentication =
    config.authentication?.scheme !== undefined
      ? {
          schemes: [config.authentication.scheme],
          credentials: config.authentication.credentials ?? '',
        }
      : undefined;

  return {
    id: config.id,
    url: config.url,
    token: config.token ?? '',
    authentication,
  };
}

function toExternalPushNotificationConfig(taskId: string, config: PushNotificationConfig) {
  const external: Record<string, unknown> = {
    id: config.id,
    taskId,
    url: config.url,
  };

  if (config.token !== undefined && config.token !== '') {
    external.token = config.token;
  }
  if (config.authentication !== undefined) {
    const authentication: Record<string, unknown> = {
      scheme: config.authentication.schemes[0],
    };
    if (config.authentication.credentials !== '') {
      authentication.credentials = config.authentication.credentials;
    }
    external.authentication = authentication;
  }

  return external;
}

export function createA2ASdkExpressApp(options: CreateA2ASdkExpressAppOptions): Express {
  const store = options.taskStore ?? new ProtocolAlignedInMemoryTaskStore();
  const pushNotificationStore =
    options.pushNotificationStore ??
    (supportsPushNotifications(options.agentCard)
      ? new InMemoryPushNotificationStore()
      : undefined);
  const requestHandler = new ProtocolAlignedRequestHandler(
    options.agentCard,
    store,
    options.agentExecutor,
    pushNotificationStore,
    options.pushNotificationSender,
    options.extendedAgentCardProvider,
  );
  const userBuilder = options.userBuilder ?? ((_) => UserBuilder.noAuthentication());

  const app = express();
  app.disable('x-powered-by');

  const agentCardPath = options.agentCardPath ?? '/.well-known/agent-card.json';
  app.use(
    agentCardPath,
    agentCardHandler({
      agentCardProvider: () => requestHandler.getAgentCard(),
    }),
  );

  const rpcPath = options.rpcPath ?? '/a2a/jsonrpc';
  const router = express.Router();
  if (options.authMiddleware) {
    router.use(options.authMiddleware);
  }
  router.use(express.json());
  router.use(normalizeA2AExtensionHeadersByVersion);
  router.use(normalizeJsonRpcRequestByVersion);
  router.use(normalizeJsonRpcResponsesByVersion);
  router.use(createRequiredExtensionsValidationHandler(options.agentCard));
  router.use(createTenantValidationHandler(options.agentCard));
  router.use(createListTasksHandler(store));
  router.use(createExtendedAgentCardCapabilityValidationHandler(options.agentCard));
  router.use(createTerminalResubscribeValidationHandler(store));
  router.use(createPushNotificationConfigHandler(options.agentCard, store, pushNotificationStore));
  router.use(jsonRpcHandler({ requestHandler, userBuilder }));
  app.use(rpcPath, router);

  return app;
}
