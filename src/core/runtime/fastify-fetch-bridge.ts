import { Readable } from 'node:stream';

export type FastifyRequestLike = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type FastifyReplyLike = {
  status: (code: number) => FastifyReplyLike;
  header: (key: string, value: string) => FastifyReplyLike;
  send: (payload?: unknown) => unknown;
};

export function buildFetchRequest(input: FastifyRequestLike, baseUrl: string): Request {
  const method = input.method ?? 'GET';
  const url = new URL(input.url ?? '/', baseUrl);
  const headers = new Headers();
  const entries = input.headers ?? {};
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    }
  }

  let body: BodyInit | undefined;
  if (!['GET', 'HEAD'].includes(method.toUpperCase()) && input.body !== undefined) {
    if (
      typeof input.body === 'string' ||
      input.body instanceof Uint8Array ||
      input.body instanceof ArrayBuffer
    ) {
      body = input.body as BodyInit;
    } else if (input.body instanceof Blob) {
      body = input.body;
    } else {
      body = JSON.stringify(input.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Request(url, { method, headers, body });
}

function toNodeStream(body: ReadableStream<Uint8Array>): Readable {
  if (typeof (Readable as typeof Readable & { fromWeb?: unknown }).fromWeb === 'function') {
    return (
      Readable as typeof Readable & {
        fromWeb: (stream: ReadableStream<Uint8Array>) => Readable;
      }
    ).fromWeb(body);
  }
  return Readable.from(body as AsyncIterable<Uint8Array>);
}

export async function sendFetchResponse(
  reply: FastifyReplyLike,
  response: Response,
): Promise<void> {
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });

  if (!response.body) {
    reply.send();
    return;
  }

  reply.send(toNodeStream(response.body));
}
