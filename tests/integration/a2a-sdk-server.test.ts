import http from 'http';
import type { AddressInfo } from 'net';

import type {
  AgentCard,
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk';
import { JsonRpcTransport } from '@a2a-js/sdk/client';
import type { ExtendedAgentCardProvider, PushNotificationSender } from '@a2a-js/sdk/server';
import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../src/core/interaction/events/bus.js';
import type { TaskEnvelope } from '../../src/core/interaction/model/index.js';
import { createInteractionFacade } from '../../src/core/interaction/orchestration/facade.js';
import { buildA2AAgentCard } from '../../src/core/protocols/a2a/agent-card.js';
import { createA2AInteractionExecutor } from '../../src/core/protocols/a2a/sdk/executor.js';
import {
  createA2ASdkExpressApp,
  ProtocolAlignedInMemoryTaskStore,
} from '../../src/core/protocols/a2a/sdk/server.js';
import { toA2APublicSkills } from '../../src/core/public-capabilities/projections.js';

const BASE_CAPABILITIES = toA2APublicSkills();

type ServerHandle = {
  url: string;
  close: () => Promise<void>;
};

type ExecuteTaskFn = (
  task: TaskEnvelope,
  options?: { signal?: AbortSignal },
) => Promise<TaskEnvelope>;

async function postJsonRpc(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return await response.json();
}

async function postJsonRpcWithHeaders(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return await response.json();
}

function parseSseJsonRpcResults(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
}

async function deferExecution(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function createAbortOnlyTask(task: TaskEnvelope, signal?: AbortSignal): Promise<TaskEnvelope> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ...task, state: 'cancelled', statusMessage: 'cancelled' });
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        resolve({ ...task, state: 'cancelled', statusMessage: 'cancelled' });
      },
      { once: true },
    );
  });
}

async function startTestServer(deps: {
  executeTask: ExecuteTaskFn;
  capabilityResolver?: (message: Message) => string;
  agentCard?: ReturnType<typeof buildA2AAgentCard>;
  userBuilder?: Parameters<typeof createA2ASdkExpressApp>[0]['userBuilder'];
  extendedAgentCardProvider?: AgentCard | ExtendedAgentCardProvider;
  pushNotificationSender?: PushNotificationSender;
  taskStore?: ProtocolAlignedInMemoryTaskStore;
}) {
  const taskBus = createTaskEventBus();
  const taskStore = deps.taskStore ?? new ProtocolAlignedInMemoryTaskStore();
  const facade = createInteractionFacade({ executeTask: deps.executeTask, eventBus: taskBus });
  const executor = createA2AInteractionExecutor({
    facade,
    taskEventBus: taskBus,
    taskStore,
    capabilityResolver: deps.capabilityResolver,
  });
  const app = createA2ASdkExpressApp({
    agentCard:
      deps.agentCard ??
      buildA2AAgentCard({
        name: 'test-agent',
        url: 'http://localhost/a2a/jsonrpc',
        capabilities: BASE_CAPABILITIES,
        security: [],
      }),
    agentExecutor: executor,
    taskStore,
    userBuilder: deps.userBuilder,
    extendedAgentCardProvider: deps.extendedAgentCardProvider,
    pushNotificationSender: deps.pushNotificationSender,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err?: Error) => {
      if (err) return reject(err);
      resolve();
    });
    server.on('error', reject);
  });
  const address = server.address() as AddressInfo;
  const url = `http://${address.address}:${address.port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => (err ? reject(err) : resolve()));
      }),
  } satisfies ServerHandle;
}

function createMessage(id: string): Message {
  return {
    kind: 'message',
    messageId: id,
    role: 'user',
    parts: [{ kind: 'text', text: 'fix bug' }],
    contextId: id,
  };
}

function expectTaskEvent(event: unknown): Task {
  if (!event || typeof event !== 'object' || (event as { kind?: unknown }).kind !== 'task') {
    throw new Error('expected event to be a task');
  }
  return event as Task;
}

describe('A2A SDK express server', () => {
  test('message/send returns a completed task that can be queried', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const result = await transport.sendMessage({
        message: createMessage('msg-1'),
      });

      expect(result.kind).toBe('task');
      if (result.kind !== 'task') {
        throw new Error('expected task response');
      }
      expect(result.status.state).toBe('completed');

      const stored = await transport.getTask({ id: result.id });
      if (!stored) {
        throw new Error('missing stored task');
      }
      expect(stored.status.state).toBe('completed');
      expect(stored.metadata?.capability).toBe('autopilot');
    } finally {
      await close();
    }
  });

  test('message/send persists explicit flow-backed skill capability', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      capabilityResolver: () => 'review',
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const result = await transport.sendMessage({
        message: createMessage('msg-review'),
      });

      expect(result.kind).toBe('task');
      if (result.kind !== 'task') {
        throw new Error('expected task response');
      }

      const stored = await transport.getTask({ id: result.id });
      if (!stored) {
        throw new Error('missing stored task');
      }
      expect(stored.metadata?.capability).toBe('review');
    } finally {
      await close();
    }
  });

  test('historyLength=0 omits task history in sendMessage and getTask responses', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const result = await transport.sendMessage({
        message: createMessage('msg-history-zero'),
        configuration: { historyLength: 0 },
      });

      expect(result.kind).toBe('task');
      if (result.kind !== 'task') {
        throw new Error('expected task response');
      }
      expect(result.history).toBeUndefined();

      const defaultStored = await transport.getTask({ id: result.id });
      expect(defaultStored.history).toHaveLength(1);

      const stored = await transport.getTask({ id: result.id, historyLength: 0 });
      expect(stored.history).toBeUndefined();
    } finally {
      await close();
    }
  });

  test('A2A 1.0 SendMessage honors configuration.returnImmediately instead of waiting for task completion', async () => {
    let releaseTask: (() => void) | undefined;
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await new Promise<void>((resolve) => {
          releaseTask = resolve;
        });
        return { ...task, state: 'completed' };
      },
    });
    try {
      const response = await Promise.race([
        postJsonRpcWithHeaders(
          `${url}/a2a/jsonrpc`,
          {
            jsonrpc: '2.0',
            id: 40,
            method: 'SendMessage',
            params: {
              message: createMessage('msg-return-immediately'),
              configuration: {
                returnImmediately: true,
              },
            },
          },
          { 'A2A-Version': '1.0' },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SendMessage did not return immediately.')), 500),
        ),
      ]);

      expect(response.error).toBeUndefined();
      expect(response.result?.task).toBeDefined();
      expect(response.result?.task?.status?.state).toBe('TASK_STATE_SUBMITTED');
    } finally {
      releaseTask?.();
      await close();
    }
  });

  test('A2A 1.0 SendMessage returns a SendMessageResponse wrapper without deprecated kind fields', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const response = await postJsonRpcWithHeaders(
        `${url}/a2a/jsonrpc`,
        {
          jsonrpc: '2.0',
          id: 41,
          method: 'SendMessage',
          params: {
            message: createMessage('msg-send-wrapper'),
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(response.result.task).toBeDefined();
      expect(response.result.message).toBeUndefined();
      expect(response.result.task.id).toEqual(expect.any(String));
      expect(response.result.task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(response.result.task.kind).toBeUndefined();
      expect(response.result.kind).toBeUndefined();
    } finally {
      await close();
    }
  });

  test('A2A 1.0 SendStreamingMessage returns StreamResponse wrappers without deprecated kind fields', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'completed' };
      },
    });
    try {
      const response = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'SendStreamingMessage',
          params: {
            message: createMessage('msg-stream-wrapper'),
          },
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toMatch(/^text\/event-stream\b/i);

      const body = await response.text();
      const events = parseSseJsonRpcResults(body);
      expect(events.length).toBeGreaterThanOrEqual(2);

      const firstResult = events[0]?.result as Record<string, unknown> | undefined;
      const firstTask = firstResult?.task as Record<string, unknown> | undefined;
      expect(firstTask).toBeDefined();
      expect(firstResult?.kind).toBeUndefined();
      expect(firstTask?.kind).toBeUndefined();
      expect(firstResult?.statusUpdate).toBeUndefined();
      expect(firstResult?.artifactUpdate).toBeUndefined();

      const secondResult = events[1]?.result as Record<string, unknown> | undefined;
      const secondStatusUpdate = secondResult?.statusUpdate as Record<string, unknown> | undefined;
      expect(secondStatusUpdate).toBeDefined();
      expect(secondResult?.kind).toBeUndefined();
      expect(secondStatusUpdate?.kind).toBeUndefined();
      expect(secondStatusUpdate?.final).toBeUndefined();
    } finally {
      await close();
    }
  });

  test('public card advertises authenticated extended card support and RPC returns extended card', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { extendedAgentCard: true },
      security: [],
    });
    const extendedCard = {
      ...publicCard,
      description: 'Extended agent card',
      skills: [
        ...publicCard.skills,
        {
          id: 'internal',
          name: 'Internal capability',
          description: 'Only visible to authenticated clients.',
          tags: [],
        },
      ],
    };
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => extendedCard,
    });
    try {
      const response = await fetch(`${url}/.well-known/agent-card.json`);
      expect(response.ok).toBe(true);
      const publishedCard = await response.json();
      expect(publishedCard.capabilities.extendedAgentCard).toBe(true);
      expect(publishedCard.supportsAuthenticatedExtendedCard).toBeUndefined();

      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const authenticatedCard = await transport.getExtendedAgentCard();
      expect(authenticatedCard.description).toBe('Extended agent card');
      expect(authenticatedCard.skills.some((skill) => skill.id === 'internal')).toBe(true);
    } finally {
      await close();
    }
  });

  test('A2A 1.0 extended card responses strip legacy top-level card fields', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { extendedAgentCard: true },
      security: [{ name: 'bearer', type: 'http', scheme: 'bearer' }],
    });
    const legacyExtendedCard = {
      ...publicCard,
      description: 'Extended agent card',
      url: 'http://localhost/a2a/jsonrpc',
      protocolVersion: '0.3.0',
      preferredTransport: 'JSONRPC',
      additionalInterfaces: [
        { url: 'http://localhost/a2a/jsonrpc', transport: 'JSONRPC' },
        { url: 'http://localhost/a2a/rest', transport: 'HTTP+JSON' },
      ],
      supportsAuthenticatedExtendedCard: true,
      security: [{ bearer: [] }],
    } as AgentCard & {
      additionalInterfaces?: Array<{ transport: string; url: string }>;
      preferredTransport?: string;
      protocolVersion?: string;
      security?: Array<Record<string, string[]>>;
      supportsAuthenticatedExtendedCard?: boolean;
      url?: string;
    };
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => legacyExtendedCard,
    });
    try {
      const response = await postJsonRpcWithHeaders(
        `${url}/a2a/jsonrpc`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetExtendedAgentCard',
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.error).toBeUndefined();
      expect(response.result.description).toBe('Extended agent card');
      expect(response.result.url).toBeUndefined();
      expect(response.result.protocolVersion).toBeUndefined();
      expect(response.result.preferredTransport).toBeUndefined();
      expect(response.result.additionalInterfaces).toBeUndefined();
      expect(response.result.supportsAuthenticatedExtendedCard).toBeUndefined();
      expect(response.result.security).toBeUndefined();
      expect(response.result.supportedInterfaces).toEqual(
        (
          publicCard as AgentCard & {
            supportedInterfaces?: Array<{
              url: string;
              protocolBinding: string;
              protocolVersion: string;
            }>;
          }
        ).supportedInterfaces,
      );
      expect(response.result.securityRequirements).toEqual([{ bearer: [] }]);
    } finally {
      await close();
    }
  });

  test('A2A 1.0 extended card responses synthesize standard fields from legacy card shapes', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { extendedAgentCard: true },
      security: [{ name: 'bearer', type: 'http', scheme: 'bearer' }],
    });
    const {
      supportedInterfaces: _supportedInterfaces,
      securityRequirements: _securityRequirements,
      ...legacyBaseCard
    } = publicCard as AgentCard & {
      supportedInterfaces?: unknown;
      securityRequirements?: unknown;
    };
    const legacyExtendedCard = {
      ...legacyBaseCard,
      description: 'Legacy extended agent card',
      skills: [
        {
          id: 'secured-review',
          name: 'Secured review',
          description: 'Requires bearer auth.',
          tags: [],
          security: [{ bearer: [] }],
        },
      ],
      url: 'http://localhost/a2a/jsonrpc',
      protocolVersion: '0.3.0',
      preferredTransport: 'JSONRPC',
      additionalInterfaces: [{ url: 'http://localhost/a2a/rest', transport: 'HTTP+JSON' }],
      supportsAuthenticatedExtendedCard: true,
      security: [{ bearer: [] }],
    } as AgentCard & {
      additionalInterfaces?: Array<{ transport: string; url: string }>;
      preferredTransport?: string;
      protocolVersion?: string;
      security?: Array<Record<string, string[]>>;
      supportsAuthenticatedExtendedCard?: boolean;
      url?: string;
    };
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => legacyExtendedCard,
    });
    try {
      const response = await postJsonRpcWithHeaders(
        `${url}/a2a/jsonrpc`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetExtendedAgentCard',
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.error).toBeUndefined();
      expect(response.result.description).toBe('Legacy extended agent card');
      expect(response.result.supportedInterfaces).toEqual([
        {
          url: 'http://localhost/a2a/jsonrpc',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
        {
          url: 'http://localhost/a2a/rest',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
      ]);
      expect(response.result.securityRequirements).toEqual([{ bearer: [] }]);
      expect(response.result.capabilities.extendedAgentCard).toBe(true);
      expect(response.result.url).toBeUndefined();
      expect(response.result.additionalInterfaces).toBeUndefined();
      expect(response.result.supportsAuthenticatedExtendedCard).toBeUndefined();
      expect(response.result.security).toBeUndefined();
      expect(response.result.skills).toEqual([
        {
          id: 'secured-review',
          name: 'Secured review',
          description: 'Requires bearer auth.',
          tags: [],
          securityRequirements: [{ bearer: [] }],
        },
      ]);
    } finally {
      await close();
    }
  });

  test('A2A 1.0 extended card requests ignore legacy top-level support flags', async () => {
    const legacyOnlyCard = {
      ...buildA2AAgentCard({
        name: 'test-agent',
        url: 'http://localhost/a2a/jsonrpc',
        capabilities: BASE_CAPABILITIES,
        security: [],
      }),
      supportsAuthenticatedExtendedCard: true,
    } as AgentCard & { supportsAuthenticatedExtendedCard?: boolean };
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: legacyOnlyCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => ({
        ...legacyOnlyCard,
        description: 'legacy extended card',
      }),
    });
    try {
      const response = await postJsonRpcWithHeaders(
        `${url}/a2a/jsonrpc`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetExtendedAgentCard',
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32004,
        message: 'Unsupported operation: Agent does not support authenticated extended card.',
      });
    } finally {
      await close();
    }
  });

  test('accepts A2A 1.0 PascalCase JSON-RPC method names when A2A-Version is 1.0', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { extendedAgentCard: true },
      security: [],
    });
    const extendedCard = {
      ...publicCard,
      description: 'Extended agent card',
    };
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => extendedCard,
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const sendResponse = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: {
            message: createMessage('msg-pascal-send'),
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(sendResponse.error).toBeUndefined();
      expect(sendResponse.result.task).toBeDefined();
      expect(sendResponse.result.task.status.state).toBe('TASK_STATE_COMPLETED');

      const getTaskResponse = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'GetTask',
          params: {
            id: sendResponse.result.task.id,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(getTaskResponse.error).toBeUndefined();
      expect(getTaskResponse.result.id).toBe(sendResponse.result.task.id);
      expect(getTaskResponse.result.status.state).toBe('TASK_STATE_COMPLETED');
      expect(getTaskResponse.result.kind).toBeUndefined();
      expect(getTaskResponse.result.history?.[0]?.kind).toBeUndefined();
      expect(getTaskResponse.result.history?.[0]?.parts?.[0]?.kind).toBeUndefined();

      const getExtendedCardResponse = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'GetExtendedAgentCard',
        },
        { 'A2A-Version': '1.0' },
      );

      expect(getExtendedCardResponse.error).toBeUndefined();
      expect(getExtendedCardResponse.result.description).toBe('Extended agent card');
    } finally {
      await close();
    }
  });

  test('A2A 1.0 JSON responses use application/a2a+json content type', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const response = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: {
            message: createMessage('msg-a2a-json-content-type'),
          },
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toMatch(/^application\/a2a\+json\b/i);

      const payload = await response.json();
      expect(payload.error).toBeUndefined();
      expect(payload.result.task.status.state).toBe('TASK_STATE_COMPLETED');
    } finally {
      await close();
    }
  });

  test('accepts official A2A-Extensions headers for A2A 1.0 and returns activated extensions with the standard header name', async () => {
    const extensionUri = 'https://example.com/a2a/extensions/review-context';
    let requestedExtensions: string[] | undefined;
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: {
        extendedAgentCard: true,
        extensions: [
          {
            uri: extensionUri,
            description: 'Provides repository review context.',
            required: false,
          },
        ],
      },
      security: [],
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async (context) => {
        requestedExtensions = context?.requestedExtensions
          ? Array.from(context.requestedExtensions)
          : undefined;
        context?.addActivatedExtension(extensionUri);
        return publicCard;
      },
    });
    try {
      const response = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'A2A-Version': '1.0',
          'A2A-Extensions': extensionUri,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'GetExtendedAgentCard',
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('A2A-Extensions')).toBe(extensionUri);
      expect(response.headers.get('X-A2A-Extensions')).toBeNull();

      const payload = await response.json();
      expect(payload.error).toBeUndefined();
      expect(payload.result.name).toBe('test-agent');
      expect(requestedExtensions).toEqual([extensionUri]);
    } finally {
      await close();
    }
  });

  test('A2A 1.0 rejects requests that omit required extension declarations', async () => {
    const requiredExtensionUri = 'https://example.com/a2a/extensions/required-review-context';
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: {
        extendedAgentCard: true,
        extensions: [
          {
            uri: requiredExtensionUri,
            description: 'Required review context.',
            required: true,
          },
        ],
      },
      security: [],
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => publicCard,
    });
    try {
      const missingExtensionResponse = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'GetExtendedAgentCard',
        }),
      });

      expect(missingExtensionResponse.ok).toBe(true);
      const missingExtensionPayload = await missingExtensionResponse.json();
      expect(missingExtensionPayload.result).toBeUndefined();
      expect(missingExtensionPayload.error).toEqual({
        code: -32008,
        message: `Extension support required: ${requiredExtensionUri}`,
      });

      const acceptedResponse = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'A2A-Version': '1.0',
          'A2A-Extensions': requiredExtensionUri,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'GetExtendedAgentCard',
        }),
      });

      expect(acceptedResponse.ok).toBe(true);
      const acceptedPayload = await acceptedResponse.json();
      expect(acceptedPayload.error).toBeUndefined();
      expect(acceptedPayload.result.name).toBe('test-agent');
    } finally {
      await close();
    }
  });

  test('supports A2A 1.0 ListTasks with filtering, pagination, historyLength, and includeArtifacts', async () => {
    const sharedContextId = 'ctx-list-1';
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({
        ...task,
        state: 'completed',
        artifacts: [
          {
            id: `artifact-${task.id}`,
            name: 'result.txt',
            kind: 'file',
            mimeType: 'text/plain',
            content: `artifact for ${task.id}`,
          },
        ],
      }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const firstResult = await transport.sendMessage({
        message: {
          ...createMessage('msg-list-1'),
          contextId: sharedContextId,
        },
      });
      const secondResult = await transport.sendMessage({
        message: {
          ...createMessage('msg-list-2'),
          contextId: sharedContextId,
        },
      });
      if (firstResult.kind !== 'task' || secondResult.kind !== 'task') {
        throw new Error('expected task responses');
      }

      const endpoint = `${url}/a2a/jsonrpc`;
      const firstPage = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 10,
          method: 'ListTasks',
          params: {
            contextId: sharedContextId,
            status: 'TASK_STATE_COMPLETED',
            pageSize: 1,
            historyLength: 0,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(firstPage.error).toBeUndefined();
      expect(firstPage.result.totalSize).toBe(2);
      expect(firstPage.result.pageSize).toBe(1);
      expect(firstPage.result.tasks).toHaveLength(1);
      expect(firstPage.result.tasks[0]?.id).toBe(secondResult.id);
      expect(firstPage.result.tasks[0]?.status?.state).toBe('TASK_STATE_COMPLETED');
      expect(firstPage.result.tasks[0]?.kind).toBeUndefined();
      expect(firstPage.result.tasks[0]?.history).toBeUndefined();
      expect(firstPage.result.tasks[0]?.artifacts).toBeUndefined();
      expect(typeof firstPage.result.nextPageToken).toBe('string');
      expect(firstPage.result.nextPageToken.length).toBeGreaterThan(0);

      const secondPage = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 11,
          method: 'ListTasks',
          params: {
            contextId: sharedContextId,
            status: 'TASK_STATE_COMPLETED',
            pageSize: 1,
            pageToken: firstPage.result.nextPageToken,
            includeArtifacts: true,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(secondPage.error).toBeUndefined();
      expect(secondPage.result.totalSize).toBe(2);
      expect(secondPage.result.pageSize).toBe(1);
      expect(secondPage.result.tasks).toHaveLength(1);
      expect(secondPage.result.tasks[0]?.id).toBe(firstResult.id);
      expect(secondPage.result.tasks[0]?.status?.state).toBe('TASK_STATE_COMPLETED');
      expect(secondPage.result.tasks[0]?.kind).toBeUndefined();
      expect(secondPage.result.tasks[0]?.artifacts?.[0]?.parts?.[0]?.kind).toBeUndefined();
      expect(secondPage.result.tasks[0]?.artifacts).toHaveLength(1);
      expect(secondPage.result.nextPageToken).toBe('');
    } finally {
      await close();
    }
  });

  test('requires tenant to match the selected A2A 1.0 JSON-RPC interface when agent card declares one', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'tenant-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { extendedAgentCard: true },
      security: [],
    }) as AgentCard & {
      supportedInterfaces: Array<{
        url: string;
        protocolBinding: string;
        protocolVersion: string;
        tenant?: string;
      }>;
    };
    publicCard.supportedInterfaces = [
      {
        ...publicCard.supportedInterfaces[0]!,
        tenant: 'tenant-acme',
      },
    ];
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      userBuilder: async () => ({
        get isAuthenticated() {
          return true;
        },
        get userName() {
          return 'alice';
        },
      }),
      extendedAgentCardProvider: async () => publicCard,
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;

      const missingTenant = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 20,
          method: 'GetExtendedAgentCard',
        },
        { 'A2A-Version': '1.0' },
      );

      expect(missingTenant.result).toBeUndefined();
      expect(missingTenant.error).toEqual({
        code: -32602,
        message: 'Invalid params: tenant must be exactly "tenant-acme" for this agent interface.',
      });

      const wrongTenant = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 21,
          method: 'SendMessage',
          params: {
            tenant: 'tenant-other',
            message: createMessage('msg-tenant-wrong'),
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(wrongTenant.result).toBeUndefined();
      expect(wrongTenant.error).toEqual({
        code: -32602,
        message: 'Invalid params: tenant must be exactly "tenant-acme" for this agent interface.',
      });

      const accepted = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 22,
          method: 'SendMessage',
          params: {
            tenant: 'tenant-acme',
            message: createMessage('msg-tenant-ok'),
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(accepted.error).toBeUndefined();
      expect(accepted.result.task).toBeDefined();
      expect(accepted.result.task.status.state).toBe('TASK_STATE_COMPLETED');
    } finally {
      await close();
    }
  });

  test('A2A 1.0 ListTasks accepts TASK_STATE_CANCELED status filters', async () => {
    const taskStore = new ProtocolAlignedInMemoryTaskStore();
    await taskStore.save({
      kind: 'task',
      id: 'task-list-tasks-canceled',
      contextId: 'ctx-list-tasks-canceled',
      history: [],
      artifacts: [],
      status: {
        state: 'canceled',
        timestamp: '2026-05-29T00:00:00.000Z',
      },
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => task,
      taskStore,
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;

      const listed = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 23,
          method: 'ListTasks',
          params: {
            status: 'TASK_STATE_CANCELED',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(listed.error).toBeUndefined();
      expect(listed.result.tasks).toHaveLength(1);
      expect(listed.result.tasks[0]?.id).toBe('task-list-tasks-canceled');
      expect(listed.result.tasks[0]?.status?.state).toBe('TASK_STATE_CANCELED');
    } finally {
      await close();
    }
  });

  test('A2A 1.0 ListTasks rejects non-ISO statusTimestampAfter values', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const response = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 26,
          method: 'ListTasks',
          params: {
            statusTimestampAfter: 'May 1 2026',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32602,
        message: 'ListTasks statusTimestampAfter must be a valid timestamp.',
      });
    } finally {
      await close();
    }
  });

  test('A2A 1.0 ListTasks rejects calendar-invalid statusTimestampAfter values', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const response = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 26.1,
          method: 'ListTasks',
          params: {
            statusTimestampAfter: '2026-02-30T00:00:00Z',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32602,
        message: 'ListTasks statusTimestampAfter must be a valid timestamp.',
      });
    } finally {
      await close();
    }
  });

  test('A2A 1.0 ListTasks accepts TASK_STATE_UNSPECIFIED as an unfiltered enum value', async () => {
    const sharedContextId = 'ctx-list-unspecified';
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      await transport.sendMessage({
        message: {
          ...createMessage('msg-list-unspecified-1'),
          contextId: sharedContextId,
        },
      });
      await transport.sendMessage({
        message: {
          ...createMessage('msg-list-unspecified-2'),
          contextId: sharedContextId,
        },
      });

      const endpoint = `${url}/a2a/jsonrpc`;
      const response = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 27,
          method: 'ListTasks',
          params: {
            contextId: sharedContextId,
            status: 'TASK_STATE_UNSPECIFIED',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.error).toBeUndefined();
      expect(response.result.totalSize).toBe(2);
      expect(response.result.tasks).toHaveLength(2);
      expect(response.result.tasks[0]?.status?.state).toBe('TASK_STATE_COMPLETED');
      expect(response.result.tasks[1]?.status?.state).toBe('TASK_STATE_COMPLETED');
    } finally {
      await close();
    }
  });

  test('treats missing A2A-Version as 0.3 and rejects 1.0-only PascalCase JSON-RPC method names', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const response = await postJsonRpc(endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'SendMessage',
        params: {
          message: createMessage('msg-pascal-without-version'),
        },
      });

      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32601,
        message: 'Method not found: SendMessage',
      });
    } finally {
      await close();
    }
  });

  test('rejects unsupported A2A-Version values', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const response = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: createMessage('msg-unsupported-version'),
          },
        },
        { 'A2A-Version': '0.5' },
      );

      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32009,
        message: 'A2A protocol version 0.5 is not supported.',
      });
    } finally {
      await close();
    }
  });

  test('rejects legacy 0.3 JSON-RPC method names when A2A-Version is 1.0', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const response = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: createMessage('msg-legacy-method-on-v1'),
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32601,
        message: 'Method not found: message/send',
      });
    } finally {
      await close();
    }
  });

  test('A2A 1.0 SendStreamingMessage rejects requests when the agent card does not advertise streaming', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'non-streaming-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { streaming: false },
      security: [],
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
    });
    try {
      const response = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'SendStreamingMessage',
          params: {
            message: createMessage('msg-non-streaming'),
          },
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toMatch(/^application\/a2a\+json\b/i);

      const payload = await response.json();
      expect(payload.result).toBeUndefined();
      expect(payload.error).toEqual({
        code: -32004,
        message: 'Unsupported operation: Method message/stream requires streaming capability.',
      });
    } finally {
      await close();
    }
  });

  test('A2A 1.0 streaming responses do not expose legacy final status flag', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'completed' };
      },
    });
    try {
      const response = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'SendStreamingMessage',
          params: {
            message: createMessage('msg-v1-stream-no-final'),
          },
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toMatch(/^text\/event-stream\b/i);

      const body = await response.text();
      const events = parseSseJsonRpcResults(body);
      expect(events).toHaveLength(2);

      expect(events[0]?.result).toMatchObject({
        task: {
          status: { state: 'TASK_STATE_SUBMITTED' },
        },
      });
      expect(events[1]?.result).toMatchObject({
        statusUpdate: {
          status: { state: 'TASK_STATE_COMPLETED' },
        },
      });
      const secondWrappedStatusUpdate =
        events[1]?.result && typeof events[1].result === 'object' && events[1].result !== null
          ? ((events[1].result as Record<string, unknown>).statusUpdate as
              | Record<string, unknown>
              | undefined)
          : undefined;
      expect(secondWrappedStatusUpdate ? 'final' in secondWrappedStatusUpdate : false).toBe(false);
    } finally {
      await close();
    }
  });

  test('A2A 1.0 SubscribeToTask rejects terminal tasks instead of streaming their final snapshot', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const result = await transport.sendMessage({
        message: createMessage('msg-v1-subscribe-terminal'),
      });

      if (result.kind !== 'task') {
        throw new Error('expected task response');
      }

      const response = await fetch(`${url}/a2a/jsonrpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'SubscribeToTask',
          params: {
            id: result.id,
          },
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toMatch(/^application\/a2a\+json\b/i);

      const payload = await response.json();
      expect(payload.result).toBeUndefined();
      expect(payload.error).toEqual({
        code: -32004,
        message: 'Unsupported operation: SubscribeToTask is not available for terminal tasks.',
      });
    } finally {
      await close();
    }
  });

  test('A2A 1.0 push notification config methods accept standard flat shapes and persist configs', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { pushNotifications: true },
      security: [],
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      pushNotificationSender: {
        send: async () => {},
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const task = await transport.sendMessage({
        message: createMessage('msg-v1-push-config'),
      });
      if (task.kind !== 'task') {
        throw new Error('expected task response');
      }

      const endpoint = `${url}/a2a/jsonrpc`;
      const createdOne = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 30,
          method: 'CreateTaskPushNotificationConfig',
          params: {
            taskId: task.id,
            id: 'cfg-1',
            url: 'https://example.com/hooks/1',
            token: 'token-1',
            authentication: {
              scheme: 'Bearer',
              credentials: 'secret-1',
            },
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(createdOne.error).toBeUndefined();
      expect(createdOne.result).toEqual({
        id: 'cfg-1',
        taskId: task.id,
        url: 'https://example.com/hooks/1',
        token: 'token-1',
        authentication: {
          scheme: 'Bearer',
          credentials: 'secret-1',
        },
      });

      const createdTwo = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 31,
          method: 'CreateTaskPushNotificationConfig',
          params: {
            taskId: task.id,
            id: 'cfg-2',
            url: 'https://example.com/hooks/2',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(createdTwo.error).toBeUndefined();
      expect(createdTwo.result).toEqual({
        id: 'cfg-2',
        taskId: task.id,
        url: 'https://example.com/hooks/2',
      });

      const firstPage = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 32,
          method: 'ListTaskPushNotificationConfigs',
          params: {
            taskId: task.id,
            pageSize: 1,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(firstPage.error).toBeUndefined();
      expect(firstPage.result.configs).toHaveLength(1);
      expect(firstPage.result.configs[0]).toEqual({
        id: 'cfg-1',
        taskId: task.id,
        url: 'https://example.com/hooks/1',
        token: 'token-1',
        authentication: {
          scheme: 'Bearer',
          credentials: 'secret-1',
        },
      });
      expect(firstPage.result.nextPageToken).toBe('cfg-1');

      const secondPage = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 33,
          method: 'ListTaskPushNotificationConfigs',
          params: {
            taskId: task.id,
            pageSize: 1,
            pageToken: firstPage.result.nextPageToken,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(secondPage.error).toBeUndefined();
      expect(secondPage.result.configs).toEqual([
        {
          id: 'cfg-2',
          taskId: task.id,
          url: 'https://example.com/hooks/2',
        },
      ]);
      expect(secondPage.result.nextPageToken).toBe('');

      const fetched = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 34,
          method: 'GetTaskPushNotificationConfig',
          params: {
            taskId: task.id,
            id: 'cfg-1',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(fetched.error).toBeUndefined();
      expect(fetched.result).toEqual({
        id: 'cfg-1',
        taskId: task.id,
        url: 'https://example.com/hooks/1',
        token: 'token-1',
        authentication: {
          scheme: 'Bearer',
          credentials: 'secret-1',
        },
      });

      const deleted = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 35,
          method: 'DeleteTaskPushNotificationConfig',
          params: {
            taskId: task.id,
            id: 'cfg-1',
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(deleted.error).toBeUndefined();
      expect(deleted.result).toEqual({});

      const remaining = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 36,
          method: 'ListTaskPushNotificationConfigs',
          params: {
            taskId: task.id,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(remaining.error).toBeUndefined();
      expect(remaining.result).toEqual({
        configs: [
          {
            id: 'cfg-2',
            taskId: task.id,
            url: 'https://example.com/hooks/2',
          },
        ],
        nextPageToken: '',
      });
    } finally {
      await close();
    }
  });

  test('A2A 1.0 SendMessage persists configuration.taskPushNotificationConfig for the created task', async () => {
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { pushNotifications: true },
      security: [],
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      pushNotificationSender: {
        send: async () => {},
      },
    });
    try {
      const endpoint = `${url}/a2a/jsonrpc`;
      const sendResponse = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 37,
          method: 'SendMessage',
          params: {
            message: createMessage('msg-v1-inline-push-config'),
            configuration: {
              taskPushNotificationConfig: {
                id: 'cfg-inline',
                url: 'https://example.com/hooks/inline',
                token: 'token-inline',
                authentication: {
                  scheme: 'Bearer',
                  credentials: 'secret-inline',
                },
              },
            },
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(sendResponse.error).toBeUndefined();
      expect(sendResponse.result?.task).toBeDefined();

      const taskId = sendResponse.result?.task?.id;
      expect(typeof taskId).toBe('string');

      const listed = await postJsonRpcWithHeaders(
        endpoint,
        {
          jsonrpc: '2.0',
          id: 38,
          method: 'ListTaskPushNotificationConfigs',
          params: {
            taskId,
          },
        },
        { 'A2A-Version': '1.0' },
      );

      expect(listed.error).toBeUndefined();
      expect(listed.result).toEqual({
        configs: [
          {
            id: 'cfg-inline',
            taskId,
            url: 'https://example.com/hooks/inline',
            token: 'token-inline',
            authentication: {
              scheme: 'Bearer',
              credentials: 'secret-inline',
            },
          },
        ],
        nextPageToken: '',
      });
    } finally {
      await close();
    }
  });

  test('authenticated extended card rejects unauthenticated requests before invoking the provider', async () => {
    let providerCalls = 0;
    const publicCard = buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost/a2a/jsonrpc',
      capabilities: BASE_CAPABILITIES,
      capabilityOptions: { extendedAgentCard: true },
      security: [{ name: 'bearer', type: 'http', scheme: 'bearer' }],
    });
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      agentCard: publicCard,
      extendedAgentCardProvider: async () => {
        providerCalls += 1;
        return {
          ...publicCard,
          description: 'Should not be returned without authentication',
        };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });

      await expect(transport.getExtendedAgentCard()).rejects.toThrow(/Authentication required/i);
      expect(providerCalls).toBe(0);
    } finally {
      await close();
    }
  });

  test('message/stream yields status updates and cancel observes cancellation', async () => {
    const { url, close } = await startTestServer({
      executeTask: (task, options) => createAbortOnlyTask(task, options?.signal),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-2') });

      const first = await iterator.next();
      expect(first.done).toBe(false);
      const firstTask = expectTaskEvent(first.value);
      expect(firstTask.status.state).toBe('submitted');

      const taskId = firstTask.id;
      expect(taskId).toBeDefined();
      await transport.cancelTask({ id: taskId! });
      const second = await iterator.next();
      expect(second.done).toBe(false);
      if (!second.value || second.value.kind !== 'status-update') {
        throw new Error('expected second event to be a status update');
      }
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('canceled');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  /**
   * Bug Condition Exploration Test - Property 1: Fault Condition
   * **Validates: Requirements - Race Condition Between Completion and Cancellation**
   *
   * This test verifies that when a task completes and cancellation is requested during
   * the grace period, only "canceled" status is published (no "completed" event).
   *
   * Original Issue: When cancellation arrives after task completion, the SSE stream
   * would publish "completed", call eventBus.finished(), and close the stream before
   * the cancellation could be processed. This caused iterator.next() to receive
   * "completed" instead of "canceled".
   *
   * Fix: Delay publishing "completed" by COMPLETION_GRACE_PERIOD_MS to allow
   * cancellation requests to arrive. Check store state after delay to detect
   * cancellation and publish "canceled" instead.
   */
  test('BUG CONDITION: cancellation during grace period publishes only canceled status', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        // Task completes immediately
        return { ...task, state: 'completed' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-race') });

      const first = await iterator.next();
      expect(first.done).toBe(false);
      const firstTask = expectTaskEvent(first.value);
      expect(firstTask.status.state).toBe('submitted');

      const taskId = firstTask.id;
      expect(taskId).toBeDefined();

      // Cancel immediately after task completes (during grace period)
      await transport.cancelTask({ id: taskId! });

      // Collect all subsequent status updates
      const statusUpdates: TaskStatusUpdateEvent[] = [];
      let result = await iterator.next();
      while (!result.done) {
        if (result.value && result.value.kind === 'status-update') {
          statusUpdates.push(result.value as TaskStatusUpdateEvent);
        }
        result = await iterator.next();
      }

      // Verify only "canceled" status is published (no "completed")
      const completedUpdates = statusUpdates.filter((u) => u.status.state === 'completed');
      const canceledUpdates = statusUpdates.filter((u) => u.status.state === 'canceled');

      expect(completedUpdates.length).toBe(0); // No completed status should be published
      expect(canceledUpdates.length).toBe(1); // Only one canceled status
      expect(canceledUpdates[0].final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  /**
   * Preservation Property Tests - Property 2: Preservation
   */

  test('PRESERVATION: task completes normally without cancellation', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'completed' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-normal') });

      const first = await iterator.next();
      expect(first.done).toBe(false);
      const firstTask = expectTaskEvent(first.value);
      expect(firstTask.status.state).toBe('submitted');

      const second = await iterator.next();
      expect(second.done).toBe(false);
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('completed');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  test('message/stream publishes artifact updates before final status when artifacts are produced', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return {
          ...task,
          state: 'completed',
          artifacts: [
            {
              id: 'artifact-1',
              kind: 'file',
              name: 'result.txt',
              content: 'Result content',
            },
          ],
        };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-artifact') });

      const first = await iterator.next();
      expect(first.done).toBe(false);
      const firstTask = expectTaskEvent(first.value);
      expect(firstTask.status.state).toBe('submitted');

      const second = await iterator.next();
      expect(second.done).toBe(false);
      if (!second.value || second.value.kind !== 'artifact-update') {
        throw new Error('expected second event to be an artifact update');
      }
      const artifactUpdate = second.value as TaskArtifactUpdateEvent;
      expect(artifactUpdate.artifact?.artifactId).toBe('artifact-1');
      expect(artifactUpdate.artifact?.name).toBe('result.txt');
      expect(artifactUpdate.artifact?.parts).toEqual([{ kind: 'text', text: 'Result content' }]);
      expect(artifactUpdate.append).toBe(false);
      expect(artifactUpdate.lastChunk).toBe(true);

      const third = await iterator.next();
      expect(third.done).toBe(false);
      if (!third.value || third.value.kind !== 'status-update') {
        throw new Error('expected third event to be a status update');
      }
      const thirdUpdate = third.value as TaskStatusUpdateEvent;
      expect(thirdUpdate.status.state).toBe('completed');
      expect(thirdUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  test('PRESERVATION: task cancelled before completion', async () => {
    const { url, close } = await startTestServer({
      executeTask: (task, options) => createAbortOnlyTask(task, options?.signal),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-cancel') });

      const first = await iterator.next();
      const firstTask = expectTaskEvent(first.value);
      const taskId = firstTask.id;
      await transport.cancelTask({ id: taskId! });

      const second = await iterator.next();
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('canceled');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  test('PRESERVATION: failed tasks publish failed status', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'failed', statusMessage: 'error' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-fail') });

      const first = await iterator.next();
      const firstTask = expectTaskEvent(first.value);
      expect(firstTask.status.state).toBe('submitted');

      const second = await iterator.next();
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('failed');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  test('PRESERVATION: terminal states have final flag', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'completed' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-term') });

      let completedUpdate: TaskStatusUpdateEvent | null = null;
      let result = await iterator.next();
      while (!result.done) {
        if (result.value && result.value.kind === 'status-update') {
          const update = result.value as TaskStatusUpdateEvent;
          if (update.status.state === 'completed') {
            completedUpdate = update;
            break;
          }
        }
        result = await iterator.next();
      }

      expect(completedUpdate).not.toBeNull();
      expect(completedUpdate?.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });
});
