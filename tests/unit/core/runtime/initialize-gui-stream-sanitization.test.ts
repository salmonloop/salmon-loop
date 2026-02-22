import { initializeRuntime } from '../../../../src/core/runtime/initialize.js';

describe('initializeRuntime (gui stream sanitization)', () => {
  test('redacts large AI SDK-style error dumps written directly to stderr in gui mode', () => {
    const originalArgv = process.argv.slice();
    const originalDebug = process.env.SALMONLOOP_DEBUG;
    const originalWrite = process.stderr.write;

    const writes: string[] = [];
    (process.stderr as any).write = (chunk: any) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk));
      return true;
    };

    try {
      process.env.SALMONLOOP_DEBUG = 'false';
      process.argv = [...originalArgv, '--gui'];
      delete (globalThis as any).__SALMON_RUNTIME_INITIALIZED__;

      initializeRuntime();

      const dump =
        "APICallError [AI_APICallError]: Service Unavailable\\nrequestBodyValues: [Object]\\nresponseBody: 'no healthy upstream'\\n[Symbol(vercel.ai.error)]: true";
      process.stderr.write(dump);

      const out = writes.join('');
      expect(out).toContain('ERR_TECHNICAL_DETAILS_HIDDEN');
      expect(out).not.toContain('requestBodyValues');
      expect(out).not.toContain('responseBody');
      expect(out).not.toContain('vercel.ai.error');
    } finally {
      process.argv = originalArgv;
      if (originalDebug === undefined) delete process.env.SALMONLOOP_DEBUG;
      else process.env.SALMONLOOP_DEBUG = originalDebug;
      (process.stderr as any).write = originalWrite;
      delete (globalThis as any).__SALMON_RUNTIME_INITIALIZED__;
    }
  });

  test('drops AI_RetryError retry summaries in gui mode', () => {
    const originalArgv = process.argv.slice();
    const originalDebug = process.env.SALMONLOOP_DEBUG;
    const originalWrite = process.stdout.write;

    const writes: string[] = [];
    (process.stdout as any).write = (chunk: any) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk));
      return true;
    };

    try {
      process.env.SALMONLOOP_DEBUG = 'false';
      process.argv = [...originalArgv, '--gui'];
      delete (globalThis as any).__SALMON_RUNTIME_INITIALIZED__;

      initializeRuntime();

      process.stdout.write(
        '[AI_RetryError] Failed after 3 attempts. Last error: Service Unavailable\n',
      );

      const out = writes.join('');
      expect(out).not.toContain('AI_RetryError');
      expect(out).not.toContain('Last error:');
    } finally {
      process.argv = originalArgv;
      if (originalDebug === undefined) delete process.env.SALMONLOOP_DEBUG;
      else process.env.SALMONLOOP_DEBUG = originalDebug;
      (process.stdout as any).write = originalWrite;
      delete (globalThis as any).__SALMON_RUNTIME_INITIALIZED__;
    }
  });
});
