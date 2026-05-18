import { Readable, Writable } from 'node:stream';

import { AgentSideConnection, type Agent, type AnyMessage } from '@agentclientprotocol/sdk';

import { tryGetLogger } from '../../observability/logger.js';

const INVALID_REQUEST = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32600, message: 'Invalid Request' },
} as const;

const PARSE_ERROR = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32700, message: 'Parse error' },
} as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function formatLineSnippet(line: string, maxLength = 160): string {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 3)}...`;
}

function normalizeJsonRpcParams(message: Record<string, unknown>) {
  if (typeof message.method !== 'string') return;
  if (!hasOwn(message, 'params') || message.params === null) {
    message.params = {};
  }
}

function safeWarn(message: string): void {
  const logger = tryGetLogger();
  if (logger) logger.warn(message);
}

type NdjsonWriter = {
  write: (message: unknown) => Promise<void>;
};

function createNdjsonWriter(output: WritableStream<Uint8Array>): NdjsonWriter {
  const writer = output.getWriter();
  const encoder = new TextEncoder();

  let tail: Promise<unknown> = Promise.resolve();

  return {
    async write(message) {
      const content = JSON.stringify(message) + '\n';
      const data = encoder.encode(content);

      tail = tail
        .catch(() => undefined)
        .then(() => writer.write(data))
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          safeWarn(`ACP stdio failed to write NDJSON line. reason="${detail}"`);
        });

      await tail;
    },
  };
}

async function writeInvalidRequest(ndjson: NdjsonWriter, line: string) {
  const snippet = formatLineSnippet(line);
  safeWarn(`ACP stdio received non-object JSON; returning Invalid Request. line="${snippet}"`);
  await ndjson.write(INVALID_REQUEST);
}

async function processStdioLine(
  line: string,
  ndjson: NdjsonWriter,
  controller: ReadableStreamDefaultController<AnyMessage>,
) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed)) {
      await writeInvalidRequest(ndjson, trimmed);
      return;
    }

    normalizeJsonRpcParams(parsed);

    if (parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)) {
      const params = parsed.params as Record<string, unknown>;
      if (params.mcpServers === null) {
        delete params.mcpServers;
      }
    }

    controller.enqueue(parsed as AnyMessage);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    safeWarn(`ACP stdio failed to parse JSON line. reason="${detail}"`);
    await ndjson.write(PARSE_ERROR);
  }
}

export function createAcpStdioStream(
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
) {
  const textDecoder = new TextDecoder();
  const ndjson = createNdjsonWriter(output);

  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      let buffer = '';
      const reader = input.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buffer += textDecoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            await processStdioLine(line, ndjson, controller);
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      await ndjson.write(message);
    },
  });

  return { readable, writable };
}

export function startAcpStdioServer(createAgent: (conn: AgentSideConnection) => Agent) {
  const output = Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>;
  const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const stream = createAcpStdioStream(output, input);
  return new AgentSideConnection((conn) => createAgent(conn), stream);
}
