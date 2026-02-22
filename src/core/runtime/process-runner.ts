import { spawn } from 'child_process';

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
  onStdoutChunk?: (chunk: Uint8Array) => void;
  onStderrChunk?: (chunk: Uint8Array) => void;
}

export interface SpawnCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  error?: { code?: string; message: string };
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

async function spawnWithBun(
  input: SpawnCommandInput,
  bun: BunRuntime,
): Promise<SpawnCommandResult> {
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
  }

  await Promise.all([stdoutPump, stderrPump]);

  return {
    code,
    signal: normalizeSignal(subprocess.signalCode),
    timedOut,
    error,
  };
}

async function spawnWithNode(input: SpawnCommandInput): Promise<SpawnCommandResult> {
  return await new Promise((resolve) => {
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let timedOut = false;

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
      settle({
        code: -1,
        signal: null,
        timedOut: false,
        error: { code: error?.code, message: String(error?.message ?? error) },
      });
    });

    child.on('close', (code, signal) => {
      settle({
        code,
        signal: normalizeSignal(signal),
        timedOut,
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
