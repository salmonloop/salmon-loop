import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

export interface SpawnCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: Buffer | string;
  timeoutMs?: number;
  killGraceMs?: number;
  detached?: boolean;
  windowsHide?: boolean;
  signal?: AbortSignal;
  onStdoutChunk?: (chunk: Uint8Array) => void;
  onStderrChunk?: (chunk: Uint8Array) => void;
}

export interface SpawnCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted?: boolean;
  error?: { code?: string; message: string };
}

export interface SpawnInteractiveInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  detached?: boolean;
  windowsHide?: boolean;
}

export interface InteractiveProcess {
  pid?: number;
  stdin?: { write?: (data: Buffer | string) => void; end?: () => void };
  stdout?: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream;
  kill: (signal?: NodeJS.Signals) => void;
  on: (event: 'error' | 'exit', listener: (...args: unknown[]) => void) => InteractiveProcess;
}

interface BunRuntime {
  spawn: (cmd: string[], options: Record<string, unknown>) => any;
  which?: (cmd: string) => string | null | undefined;
}

function getBunRuntime(): BunRuntime | undefined {
  const runtime = (globalThis as { Bun?: unknown }).Bun as BunRuntime | undefined;
  if (!runtime || typeof runtime.spawn !== 'function') {
    return undefined;
  }
  return runtime;
}

function normalizeSignal(value: unknown): NodeJS.Signals | null {
  if (typeof value === 'string') {
    return value as NodeJS.Signals;
  }
  return null;
}

function toNodeReadableStream(stream: unknown): NodeJS.ReadableStream | undefined {
  if (!stream) return undefined;
  if (typeof (stream as { on?: unknown }).on === 'function') {
    return stream as NodeJS.ReadableStream;
  }
  if (typeof (stream as { getReader?: unknown }).getReader === 'function') {
    return Readable.fromWeb(stream as any) as unknown as NodeJS.ReadableStream;
  }
  return undefined;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk ?? ''));
}

function writeInput(
  target: { write?: (data: Buffer | string) => void; end?: () => void },
  input?: Buffer | string,
) {
  if (input !== undefined) {
    target.write?.(input);
  }
  target.end?.();
}

async function pumpStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onChunk?: (chunk: Uint8Array) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) onChunk?.(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function createKillProcess(
  processLike: { pid?: number; kill: (signal: NodeJS.Signals) => void },
  detached: boolean | undefined,
) {
  const isWin = process.platform === 'win32';
  return (signal: NodeJS.Signals) => {
    try {
      if (!isWin && detached && typeof processLike.pid === 'number') {
        process.kill(-processLike.pid, signal);
        return;
      }
    } catch {
      // Fall back to direct child kill.
    }
    try {
      processLike.kill(signal);
    } catch {
      // Ignore kill errors.
    }
  };
}

export function spawnInteractiveProcess(input: SpawnInteractiveInput): InteractiveProcess {
  const bun = getBunRuntime();
  if (bun) {
    const subprocess = bun.spawn([input.command, ...(input.args ?? [])], {
      cwd: input.cwd,
      env: input.env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: input.detached,
      windowsHide: input.windowsHide,
    });

    const events = new EventEmitter();
    void subprocess.exited
      .then((code: number | null) => {
        events.emit('exit', code, normalizeSignal(subprocess.signalCode));
      })
      .catch((error: unknown) => {
        events.emit('error', error);
      });

    const processRef: InteractiveProcess = {
      pid: subprocess.pid,
      stdin: subprocess.stdin ?? undefined,
      stdout: toNodeReadableStream(subprocess.stdout),
      stderr: toNodeReadableStream(subprocess.stderr),
      kill: (signal = 'SIGTERM') => {
        try {
          subprocess.kill(signal);
        } catch {
          // Ignore kill errors.
        }
      },
      on: (event, listener) => {
        events.on(event, listener);
        return processRef;
      },
    };

    return processRef;
  }

  const child = spawn(input.command, input.args ?? [], {
    cwd: input.cwd,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: input.windowsHide,
    detached: input.detached,
  });

  const processRef: InteractiveProcess = {
    pid: child.pid,
    stdin: child.stdin ?? undefined,
    stdout: child.stdout ?? undefined,
    stderr: child.stderr ?? undefined,
    kill: (signal = 'SIGTERM') => {
      try {
        child.kill(signal);
      } catch {
        // Ignore kill errors.
      }
    },
    on: (event, listener) => {
      child.on(event, listener as (...args: any[]) => void);
      return processRef;
    },
  };

  return processRef;
}

async function spawnWithBun(
  input: SpawnCommandInput,
  bun: BunRuntime,
): Promise<SpawnCommandResult> {
  if (input.signal?.aborted) {
    return {
      code: null,
      signal: null,
      timedOut: false,
      aborted: true,
    };
  }

  let subprocess: any;
  try {
    subprocess = bun.spawn([input.command, ...(input.args ?? [])], {
      cwd: input.cwd,
      env: input.env,
      stdin: input.stdin !== undefined ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: input.detached,
      windowsHide: input.windowsHide,
    });
  } catch (error: any) {
    return {
      code: -1,
      signal: null,
      timedOut: false,
      error: { code: error?.code, message: String(error?.message ?? error) },
    };
  }

  writeInput(subprocess.stdin ?? {}, input.stdin);

  let timedOut = false;
  let aborted = false;
  let killTimer: NodeJS.Timeout | undefined;
  const killProcess = createKillProcess(subprocess, input.detached);
  const timeoutMs = input.timeoutMs;
  const killGraceMs = input.killGraceMs ?? 2000;

  const stdoutPump = pumpStream(subprocess.stdout, input.onStdoutChunk);
  const stderrPump = pumpStream(subprocess.stderr, input.onStderrChunk);

  let timeoutTimer: NodeJS.Timeout | undefined;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcess('SIGTERM');
      killTimer = setTimeout(() => killProcess('SIGKILL'), killGraceMs);
    }, timeoutMs);
  }

  let onAbort: (() => void) | undefined;
  if (input.signal) {
    onAbort = () => {
      aborted = true;
      killProcess('SIGTERM');
      killTimer = setTimeout(() => killProcess('SIGKILL'), killGraceMs);
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
  }

  let code: number | null = null;
  let error: { code?: string; message: string } | undefined;
  try {
    code = await subprocess.exited;
  } catch (err: any) {
    error = { code: err?.code, message: String(err?.message ?? err) };
    code = -1;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (killTimer) clearTimeout(killTimer);
    if (input.signal && onAbort) {
      input.signal.removeEventListener('abort', onAbort);
    }
  }

  await Promise.all([stdoutPump, stderrPump]);

  return {
    code,
    signal: normalizeSignal(subprocess.signalCode),
    timedOut,
    aborted,
    error,
  };
}

async function spawnWithNode(input: SpawnCommandInput): Promise<SpawnCommandResult> {
  if (input.signal?.aborted) {
    return {
      code: null,
      signal: null,
      timedOut: false,
      aborted: true,
    };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    let aborted = false;
    let onAbort: (() => void) | undefined;

    const child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: input.windowsHide,
      detached: input.detached,
    });

    const settle = (result: SpawnCommandResult) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (input.signal && onAbort) {
        input.signal.removeEventListener('abort', onAbort);
      }
      resolve(result);
    };

    const killProcess = createKillProcess(
      {
        pid: child.pid,
        kill: (signal) => child.kill(signal),
      },
      input.detached,
    );

    child.stdout?.on('data', (chunk) => {
      input.onStdoutChunk?.(toBuffer(chunk));
    });
    child.stderr?.on('data', (chunk) => {
      input.onStderrChunk?.(toBuffer(chunk));
    });

    child.on('error', (error: any) => {
      if (aborted) {
        settle({
          code: null,
          signal: null,
          timedOut: false,
          aborted: true,
        });
        return;
      }
      settle({
        code: -1,
        signal: null,
        timedOut: false,
        aborted: false,
        error: { code: error?.code, message: String(error?.message ?? error) },
      });
    });

    child.on('close', (code, signal) => {
      settle({
        code,
        signal: normalizeSignal(signal),
        timedOut,
        aborted,
      });
    });

    writeInput(child.stdin ?? {}, input.stdin);

    const timeoutMs = input.timeoutMs;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      const killGraceMs = input.killGraceMs ?? 2000;
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killProcess('SIGTERM');
        killTimer = setTimeout(() => killProcess('SIGKILL'), killGraceMs);
      }, timeoutMs);
    }

    if (input.signal) {
      onAbort = () => {
        aborted = true;
        killProcess('SIGTERM');
        killTimer = setTimeout(() => killProcess('SIGKILL'), input.killGraceMs ?? 2000);
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export async function spawnCommand(input: SpawnCommandInput): Promise<SpawnCommandResult> {
  const bun = getBunRuntime();
  if (bun) {
    return await spawnWithBun(input, bun);
  }
  return await spawnWithNode(input);
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  const bun = getBunRuntime();
  if (bun?.which) {
    return Boolean(bun.which(command));
  }

  const probe = await spawnWithNode({
    command,
    args: ['--version'],
    timeoutMs: 1500,
    windowsHide: true,
  });
  if (probe.error?.code === 'ENOENT') return false;
  if (probe.error && /not found|enoent/i.test(probe.error.message)) return false;
  return probe.code === 0;
}
