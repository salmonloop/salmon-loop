import { readFileSync } from '../adapters/fs/node-fs.js';
import { initializeDefaultCalculator } from '../context/policies/pack-until-full.js';
import { getRepoAgentsConfigPath, getUserAgentsConfigPath } from '../extensions/paths.js';
import { AgentsConfigSchema } from '../extensions/schemas.js';
import type { RawAgentsConfig } from '../extensions/types.js';
import { createLogger, getLogger, setLogger, tryGetLogger } from '../observability/logger.js';
import { createMonitor, setMonitor, tryGetMonitor } from '../observability/monitor.js';
import { registerDefaultSubAgentProfiles } from '../sub-agent/registry-defaults.js';
import {
  createSubAgentRegistry,
  setSubAgentRegistry,
  tryGetSubAgentRegistry,
} from '../sub-agent/registry.js';
import type { SubAgentProfile } from '../sub-agent/types.js';
import { isRecord } from '../utils/serialize.js';

/**
 * Initializes the Core safety runtime.
 * Mounts global error handlers and ensures environment safety.
 */
const GLOBAL_FLAG = '__SALMON_RUNTIME_INITIALIZED__' as const;

export function initializeRuntime() {
  // Prevent duplicate initialization
  if ((globalThis as Record<string, unknown>)[GLOBAL_FLAG]) return;

  // Bypass interception in debug mode to allow raw console/stream output
  if (process.env.SALMONLOOP_DEBUG === 'true') {
    (globalThis as Record<string, unknown>)[GLOBAL_FLAG] = true;
    return;
  }

  // Preload token calculator in background (non-blocking)
  initializeDefaultCalculator().catch(() => {
    // Silently fallback to char-based if initialization fails
  });

  // Initialize logger before installing global error handlers.
  if (!tryGetLogger()) {
    setLogger(createLogger());
  }

  // Initialize monitor once so subsystems can record metrics without hidden singletons.
  if (!tryGetMonitor()) {
    setMonitor(createMonitor());
  }

  // Sub-agent profiles are runtime state; wire explicitly for predictable tests.
  if (!tryGetSubAgentRegistry()) {
    const registry = createSubAgentRegistry();
    registerDefaultSubAgentProfiles(registry);
    loadUserAgentProfiles(registry);
    setSubAgentRegistry(registry);
  }

  const isGui = process.argv.includes('--gui');

  // 1. Terminal Output Interceptor (The Nuclear Option)
  // Monkey-patch console.error to ensure ANY direct console calls are sanitized
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const sanitizedArgs = args.map((arg) => {
      if (isRecord(arg)) {
        // Drop the object structure entirely for console output to prevent UI pollution
        const code =
          (typeof arg.code === 'string' ? arg.code : undefined) ||
          (typeof arg.llmCode === 'string' ? arg.llmCode : undefined) ||
          'TECHNICAL_ERROR';
        const msg =
          (typeof arg.message === 'string' ? arg.message : undefined) || 'No detail provided';
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
    getLogger().error('Unhandled Rejection detected in Core runtime', reason, true);
  });

  process.on('uncaughtException', (error) => {
    getLogger().error('Uncaught Exception detected in Core runtime', error, true);
  });

  (globalThis as Record<string, unknown>)[GLOBAL_FLAG] = true;
}

function loadUserAgentProfiles(registry: ReturnType<typeof createSubAgentRegistry>): void {
  const tryLoadSync = (filePath: string): RawAgentsConfig | null => {
    try {
      const content = readFileSync(filePath, 'utf-8');
      return AgentsConfigSchema.parse(JSON.parse(content));
    } catch (error) {
      getLogger().debug(
        `[InitializeRuntime] Failed to load agent config from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  // Load from repo and user scopes; repo takes priority
  const repoRoot = process.cwd();
  const userConfig = tryLoadSync(getUserAgentsConfigPath());
  const repoConfig = tryLoadSync(getRepoAgentsConfigPath(repoRoot));

  const toProfile = (raw: RawAgentsConfig['agents'][number]): SubAgentProfile => ({
    id: raw.id,
    name: raw.name,
    role: raw.role,
    description: raw.description,
    allowedTools: raw.allowedTools ?? ['code.search', 'fs.read'],
    readOnly: raw.readOnly ?? false,
    stratagem: raw.stratagem ?? 'investigator',
    toolInheritance: raw.toolInheritance,
    permissionMode: raw.permissionMode,
    systemPrompt: raw.systemPrompt,
    maxTokens: raw.maxTokens,
    maxAttempts: raw.maxAttempts,
    timeoutMs: raw.timeoutMs,
  });

  // User profiles first (lower priority)
  if (userConfig) {
    for (const agent of userConfig.agents) {
      if (agent.enabled === false) continue;
      // Don't override built-in profiles
      if (registry.has(agent.id)) {
        tryGetLogger()?.debug(
          `[initializeRuntime] Skipping user agent '${agent.id}': conflicts with built-in profile`,
        );
        continue;
      }
      registry.register(toProfile(agent));
    }
  }

  // Repo profiles override user (higher priority)
  if (repoConfig) {
    for (const agent of repoConfig.agents) {
      if (agent.enabled === false) continue;
      // Don't override built-in profiles
      if (registry.has(agent.id)) {
        tryGetLogger()?.debug(
          `[initializeRuntime] Skipping repo agent '${agent.id}': conflicts with built-in profile`,
        );
        continue;
      }
      registry.register(toProfile(agent));
    }
  }
}
