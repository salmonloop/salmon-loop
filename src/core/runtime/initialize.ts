import { logger } from '../observability/logger.js';

/**
 * Initializes the Core safety runtime.
 * Mounts global error handlers and ensures environment safety.
 */
export function initializeRuntime() {
  // Prevent duplicate initialization
  if ((globalThis as any).__SALMON_RUNTIME_INITIALIZED__) return;

  // Bypass interception in debug mode to allow raw console/stream output
  if (process.env.SALMONLOOP_DEBUG === 'true') {
    (globalThis as any).__SALMON_RUNTIME_INITIALIZED__ = true;
    return;
  }

  const isGui = process.argv.includes('--gui');

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
  // Hijack raw stdout/stderr to filter out sensitive info even if it escapes as a raw string or Buffer
  const TOKEN_ERROR_TEST_REGEX = /(Token error|api[-_]key|secret)[^ \n\r'"]*/i;
  const TOKEN_ERROR_REPLACE_REGEX = /(Token error|api[-_]key|secret)[^ \n\r'"]*/gi;
  const ERROR_DUMP_HINT_REGEX =
    /(token|api|key|secret|apicallerror|retryerror|requestbodyvalues|responsebody|vercel\.ai\.error)/i;
  const ERROR_DUMP_PAYLOAD_REGEX =
    /(requestBodyValues|responseHeaders|responseBody|\[Symbol\(vercel\.ai\.error)/i;
  const ERROR_DUMP_LINE_REGEX = /\[AI_RetryError\]\s+Failed after \d+ attempts\./i;
  const bufferHasHint = (buf: Buffer) =>
    buf.includes('Token') ||
    buf.includes('token') ||
    buf.includes('API') ||
    buf.includes('api') ||
    buf.includes('KEY') ||
    buf.includes('key') ||
    buf.includes('SECRET') ||
    buf.includes('secret') ||
    buf.includes('APICallError') ||
    buf.includes('RetryError') ||
    buf.includes('requestBodyValues') ||
    buf.includes('responseBody') ||
    buf.includes('vercel.ai.error');
  const sanitizeStream = (stream: NodeJS.WriteStream) => {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk: any, encodingOrCb?: any, cb?: any) => {
      const isBuffer = Buffer.isBuffer(chunk);
      const data = isBuffer ? '' : typeof chunk === 'string' ? chunk : '';

      // Ink-based GUI renders through high-frequency stdout writes. Avoid expensive
      // string conversions and regex checks unless the chunk looks like it may contain secrets.
      if (isGui) {
        if (isBuffer) {
          if (!chunk || chunk.length === 0) return originalWrite(chunk, encodingOrCb, cb);
          if (!bufferHasHint(chunk)) return originalWrite(chunk, encodingOrCb, cb);
        } else if (!data || !ERROR_DUMP_HINT_REGEX.test(data)) {
          return originalWrite(chunk, encodingOrCb, cb);
        }
      }

      const resolvedData = isBuffer ? chunk.toString() : data;
      if (isGui && ERROR_DUMP_LINE_REGEX.test(resolvedData)) {
        // Drop known noisy retry summaries; the UI already renders a structured retry event.
        const nextChunk = isBuffer ? Buffer.from('') : '';
        return originalWrite(nextChunk, encodingOrCb, cb);
      }
      if (isGui && ERROR_DUMP_PAYLOAD_REGEX.test(resolvedData)) {
        const redacted = 'ERR_TECHNICAL_DETAILS_HIDDEN\n';
        const nextChunk = isBuffer ? Buffer.from(redacted) : redacted;
        return originalWrite(nextChunk, encodingOrCb, cb);
      }
      if (TOKEN_ERROR_TEST_REGEX.test(resolvedData)) {
        const cleaned = resolvedData.replace(TOKEN_ERROR_REPLACE_REGEX, '[REDACTED]');
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
