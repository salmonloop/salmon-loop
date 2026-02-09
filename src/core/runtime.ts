import { logger } from './logger.js';

/**
 * Initializes the Core safety runtime.
 * Mounts global error handlers and ensures environment safety.
 */
export function initializeRuntime() {
  // Prevent duplicate initialization
  if ((globalThis as any).__SALMON_RUNTIME_INITIALIZED__) return;

  // 1. Terminal Output Interceptor (The Nuclear Option)
  // Monkey-patch console.error to ensure ANY direct console calls are sanitized
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const sanitizedArgs = args.map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        // Drop the object structure entirely for console output to prevent UI pollution
        const code = (arg as any).code || (arg as any).llmCode || 'TECHNICAL_ERROR';
        const msg = (arg as any).message || 'No detail provided';
        return `[${code}] ${msg}`;
      }
      return arg;
    });
    originalConsoleError.apply(console, sanitizedArgs);
  };

  const originalConsoleLog = console.log;
  console.log = (...args: any[]) => {
    const sanitizedArgs = args.map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        // Prevent JSON tree leakage in logs as well
        return arg instanceof Error ? `[${arg.name}] ${arg.message}` : '[Object]';
      }
      return arg;
    });
    originalConsoleLog.apply(console, sanitizedArgs);
  };

  // 1.5 Byte-Stream Interceptor (The Absolute Physical Defense)
  // Hijack raw stdout/stderr to filter out "Token error" even if it escapes as a raw string or Buffer
  const sanitizeStream = (stream: NodeJS.WriteStream) => {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk: any, encodingOrCb?: any, cb?: any) => {
      const isBuffer = Buffer.isBuffer(chunk);
      const data = isBuffer ? chunk.toString() : typeof chunk === 'string' ? chunk : '';

      if (data.includes('Token error:')) {
        const cleaned = data.replace(
          /Token error:.*?(?=\n|\r|'|"|$)/g,
          '[REDACTED SENSITIVE TOKEN INFO]',
        );
        const nextChunk = isBuffer ? Buffer.from(cleaned) : cleaned;
        return originalWrite(nextChunk, encodingOrCb, cb);
      }
      return originalWrite(chunk, encodingOrCb, cb);
    };
  };
  sanitizeStream(process.stderr);
  sanitizeStream(process.stdout);

  // 2. Global Process Handlers
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection detected in Core runtime', reason, true);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception detected in Core runtime', error, true);
  });

  (globalThis as any).__SALMON_RUNTIME_INITIALIZED__ = true;
}
