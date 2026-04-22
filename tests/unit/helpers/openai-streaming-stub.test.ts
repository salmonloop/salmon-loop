import { describe, expect, it } from 'bun:test';

import { createOpenAiStreamingStub } from '../../helpers/openai-streaming-stub.js';

describe('createOpenAiStreamingStub', () => {
  it('returns null from tryStart when local HTTP binding is unavailable', async () => {
    const listeners = new Map<string, (error?: Error) => void>();
    const server = {
      once(event: string, listener: (error?: Error) => void) {
        listeners.set(event, listener);
        return this;
      },
      listen(_port: number, _host: string, _callback: () => void) {
        listeners.get('error')?.(
          Object.assign(new Error('Failed to start server'), { code: 'EPERM' }),
        );
        return this;
      },
      address() {
        return null;
      },
      close(callback: (error?: Error) => void) {
        callback();
        return this;
      },
    };

    const stub = createOpenAiStreamingStub({
      createServer: () => server as any,
    });

    await expect(stub.tryStart()).resolves.toBeNull();
  });
});
