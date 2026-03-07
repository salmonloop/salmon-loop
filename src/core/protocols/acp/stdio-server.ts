import { Readable, Writable } from 'node:stream';

import { AgentSideConnection, type Agent, type AnyMessage } from '@agentclientprotocol/sdk';

import { getLogger } from '../../observability/logger.js';

const INVALID_REQUEST = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32600, message: 'Invalid Request' },
} as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatLineSnippet(line: string, maxLength = 160): string {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 3)}...`;
}

async function writeInvalidRequest(output: WritableStream<Uint8Array>, line: string) {
  const snippet = formatLineSnippet(line);
  getLogger().warn(
    `ACP stdio received non-object JSON; returning Invalid Request. line="${snippet}"`,
  );
  const writer = output.getWriter();
  const encoder = new TextEncoder();
  try {
    await writer.write(encoder.encode(JSON.stringify(INVALID_REQUEST) + '\n'));
  } finally {
    writer.releaseLock();
  }
}

async function processStdioLine(
  line: string,
  output: WritableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<AnyMessage>,
) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed)) {
      await writeInvalidRequest(output, trimmed);
      return;
    }

    if (parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)) {
      const params = parsed.params as Record<string, unknown>;
      if (params.mcpServers === null) {
        delete params.mcpServers;
      }
    }

    controller.enqueue(parsed as AnyMessage);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    getLogger().warn(`ACP stdio failed to parse JSON line. reason="${detail}"`);
  }
}

export function createAcpStdioStream(
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
) {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

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
            await processStdioLine(line, output, controller);
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
      const content = JSON.stringify(message) + '\n';
      const writer = output.getWriter();
      try {
        await writer.write(textEncoder.encode(content));
      } finally {
        writer.releaseLock();
      }
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
