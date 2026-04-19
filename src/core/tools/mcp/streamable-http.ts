import { getLogger } from '../../observability/logger.js';

import { LATEST_PROTOCOL_VERSION } from './types.js';
export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

export interface SseEvent {
  id?: string;
  event?: string;
  retry?: number;
  data: string;
}

function normalizeHeaderValue(value: string | null): string {
  return value ? value.trim().toLowerCase() : '';
}

export function isEventStreamResponse(response: Response): boolean {
  const contentType = normalizeHeaderValue(response.headers.get('content-type'));
  return contentType.includes('text/event-stream');
}

export async function* decodeSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  function takeEventBlocks(): string[] {
    const blocks: string[] = [];
    while (true) {
      const idx = buffer.indexOf('\n\n');
      const idxCr = buffer.indexOf('\r\n\r\n');
      const splitAt = idx === -1 ? idxCr : idxCr === -1 ? idx : Math.min(idx, idxCr);
      if (splitAt === -1) break;
      const separatorLen = buffer.startsWith('\r\n\r\n', splitAt) ? 4 : 2;
      blocks.push(buffer.slice(0, splitAt));
      buffer = buffer.slice(splitAt + separatorLen);
    }
    return blocks;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (const block of takeEventBlocks()) {
        const lines = block.split(/\r?\n/);
        const event: SseEvent = { data: '' };
        const dataLines: string[] = [];

        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith(':')) continue;

          const colon = line.indexOf(':');
          const field = (colon === -1 ? line : line.slice(0, colon)).trim();
          const rawValue = colon === -1 ? '' : line.slice(colon + 1).trimStart();

          if (field === 'id') event.id = rawValue;
          else if (field === 'event') event.event = rawValue;
          else if (field === 'retry') {
            const parsed = Number.parseInt(rawValue, 10);
            if (!Number.isNaN(parsed)) event.retry = parsed;
          } else if (field === 'data') dataLines.push(rawValue);
        }

        event.data = dataLines.join('\n');
        yield event;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export function createMcpHeaders(options: {
  protocolVersion?: string;
  sessionId?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': options.protocolVersion ?? MCP_PROTOCOL_VERSION,
    ...(options.extra ?? {}),
  };
  if (options.sessionId) headers['MCP-Session-Id'] = options.sessionId;
  return headers;
}

export function assertOk(response: Response, context: string): void {
  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${response.status}`);
  }
}

export async function safeDrainResponse(response: Response): Promise<void> {
  try {
    if (response.body) {
      await response.arrayBuffer();
    }
  } catch (err) {
    getLogger().debug(`Failed to drain response body: ${String(err)}`);
  }
}

export async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
