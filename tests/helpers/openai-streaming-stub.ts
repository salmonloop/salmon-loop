import * as http from 'http';

type OpenAiStreamingStubOptions = {
  createServer?: typeof http.createServer;
};

export type StubStreamChunk = Record<string, unknown> | '[DONE]';

export function openAiChatStreamChunk(params: {
  delta?: Record<string, unknown>;
  finishReason?: string | null;
}) {
  return {
    id: 'chatcmpl-headless-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        delta: params.delta ?? {},
        finish_reason: params.finishReason ?? null,
      },
    ],
  };
}

export function createOpenAiStreamingStub(options: OpenAiStreamingStubOptions = {}) {
  const responses: StubStreamChunk[][] = [];
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const createServer = options.createServer ?? http.createServer;
  const server = createServer(async (req, res) => {
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requests.push({
      url: req.url || '',
      method: req.method || 'GET',
      body: Buffer.concat(bodyChunks).toString('utf8'),
    });

    const next = responses.shift();
    if (!next) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { message: 'No stub response configured' } }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    for (const chunk of next) {
      const data = chunk === '[DONE]' ? '[DONE]' : JSON.stringify(chunk);
      res.write(`data: ${data}\n\n`);
    }
    res.end();
  });

  async function tryStart(): Promise<string | null> {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
    } catch {
      // These headless tests spawn a separate CLI process, so the in-process fetch fallback
      // used elsewhere in the test suite cannot service this stub. When local binding is
      // unavailable, let the caller opt out of the HTTP-backed coverage instead of hard-failing.
      return null;
    }
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind OpenAI streaming stub server');
    }
    return `http://127.0.0.1:${address.port}/v1`;
  }

  async function start(): Promise<string> {
    const baseUrl = await tryStart();
    if (baseUrl) {
      return baseUrl;
    }
    throw new Error('Failed to bind OpenAI streaming stub server');
  }

  return {
    requests,
    pushStream(chunks: StubStreamChunk[]) {
      responses.push(chunks);
    },
    tryStart,
    start,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
