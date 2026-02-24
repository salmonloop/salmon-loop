import { spawn } from 'child_process';

import { getBunRuntime, normalizeSignal } from './bun-runtime.js';
import { ProcessFailure, SpawnCommandInput, SpawnCommandResult } from './process-types.js';

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(String(chunk ?? ''));
}

function writeInput(
  target: { write?: (data: Buffer | string) => void; end?: () => void },
  input?: Buffer | string,
) {
  if (input !== undefined) target.write?.(input);
  target.end?.();
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
      // Fall back to child kill.
    }
    try {
      processLike.kill(signal);
    } catch {
      // Ignore kill errors.
    }
  };
}

function createFailure(input: SpawnCommandInput, params: Omit<ProcessFailure, 'command' | 'args'>) {
  return {
    command: input.command,
    args: input.args ?? [],
    ...params,
  };
}

interface CaptureState {
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

function createCaptureState(): CaptureState {
  return {
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function appendStdout(state: CaptureState, input: SpawnCommandInput, chunk: Uint8Array): void {
  input.onStdoutChunk?.(chunk);
  if (state.stdoutTruncated) return;
  const maxStdoutBytes = input.maxStdoutBytes ?? Number.POSITIVE_INFINITY;
  if (maxStdoutBytes <= 0) {
    state.stdoutTruncated = true;
    return;
  }
  const buffer = Buffer.from(chunk);
  const remaining = maxStdoutBytes - state.stdoutBytes;
  if (buffer.length <= remaining) {
    state.stdout += buffer.toString();
    state.stdoutBytes += buffer.length;
    return;
  }
  if (remaining > 0) {
    state.stdout += buffer.subarray(0, remaining).toString();
    state.stdoutBytes += remaining;
  }
  state.stdoutTruncated = true;
}

function appendStderr(state: CaptureState, input: SpawnCommandInput, chunk: Uint8Array): void {
  input.onStderrChunk?.(chunk);
  if (state.stderrTruncated) return;
  const maxStderrBytes = input.maxStderrBytes ?? Number.POSITIVE_INFINITY;
  if (maxStderrBytes <= 0) {
    state.stderrTruncated = true;
    return;
  }
  const buffer = Buffer.from(chunk);
  const remaining = maxStderrBytes - state.stderrBytes;
  if (buffer.length <= remaining) {
    state.stderr += buffer.toString();
    state.stderrBytes += buffer.length;
    return;
  }
  if (remaining > 0) {
    state.stderr += buffer.subarray(0, remaining).toString();
    state.stderrBytes += remaining;
  }
  state.stderrTruncated = true;
}

function finalizeResult(
  input: SpawnCommandInput,
  state: CaptureState,
  params: {
    code: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    aborted?: boolean;
    error?: { code?: string; message: string };
  },
): SpawnCommandResult {
  let failure: ProcessFailure | undefined;
  if (params.error) {
    failure = createFailure(input, {
      kind: 'spawn_error',
      message: params.error.message,
      code: params.error.code,
      exitCode: params.code,
      signal: params.signal,
    });
  } else if (params.aborted) {
    failure = createFailure(input, {
      kind: 'aborted',
      message: 'Command aborted',
      exitCode: params.code,
      signal: params.signal,
    });
  } else if (params.timedOut) {
    failure = createFailure(input, {
      kind: 'timeout',
      message: 'Command timed out',
      exitCode: params.code,
      signal: params.signal,
    });
  } else if (params.code !== 0) {
    failure = createFailure(input, {
      kind: 'nonzero_exit',
      message: `Command exited with code ${String(params.code)}`,
      exitCode: params.code,
      signal: params.signal,
    });
  }

  return {
    code: params.code,
    signal: params.signal,
    timedOut: params.timedOut,
    aborted: params.aborted,
    error: params.error,
    failure,
    stdout: state.stdout,
    stderr: state.stderr,
    stdoutTruncated: state.stdoutTruncated,
    stderrTruncated: state.stderrTruncated,
  };
}

async function pumpBunStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function spawnWithBun(input: SpawnCommandInput): Promise<SpawnCommandResult> {
  if (input.signal?.aborted) {
    return finalizeResult(input, createCaptureState(), {
      code: null,
      signal: null,
      timedOut: false,
      aborted: true,
    });
  }

  const bun = getBunRuntime();
  if (!bun) {
    throw new Error('Bun runtime is not available');
  }

  const state = createCaptureState();
  let subprocess: any;
  const bunStdin = input.stdin === undefined ? 'ignore' : input.stdin;
  try {
    subprocess = bun.spawn([input.command, ...(input.args ?? [])], {
      cwd: input.cwd,
      env: input.env,
      stdin: bunStdin,
      stdout: 'pipe',
      stderr: 'pipe',
      detached: input.detached,
      windowsHide: input.windowsHide,
    });
  } catch (error: any) {
    return finalizeResult(input, state, {
      code: -1,
      signal: null,
      timedOut: false,
      error: { code: error?.code, message: String(error?.message ?? error) },
    });
  }

  if (bunStdin === 'pipe') {
    writeInput(subprocess.stdin ?? {}, input.stdin);
  }

  let timedOut = false;
  let aborted = false;
  let killTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  const killGraceMs = input.killGraceMs ?? 2000;
  const killProcess = createKillProcess(subprocess, input.detached);

  if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcess('SIGTERM');
      killTimer = setTimeout(() => killProcess('SIGKILL'), killGraceMs);
    }, input.timeoutMs);
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

  const stdoutPump = pumpBunStream(subprocess.stdout, (chunk) => appendStdout(state, input, chunk));
  const stderrPump = pumpBunStream(subprocess.stderr, (chunk) => appendStderr(state, input, chunk));

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

  return finalizeResult(input, state, {
    code,
    signal: normalizeSignal(subprocess.signalCode),
    timedOut,
    aborted,
    error,
  });
}

async function spawnWithNode(input: SpawnCommandInput): Promise<SpawnCommandResult> {
  if (input.signal?.aborted) {
    return finalizeResult(input, createCaptureState(), {
      code: null,
      signal: null,
      timedOut: false,
      aborted: true,
    });
  }

  const state = createCaptureState();

  return await new Promise((resolve) => {
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    const child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: input.windowsHide,
      detached: input.detached,
    });

    const settle = (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: { code?: string; message: string },
    ) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (input.signal && onAbort) {
        input.signal.removeEventListener('abort', onAbort);
      }
      resolve(
        finalizeResult(input, state, {
          code,
          signal,
          timedOut,
          aborted,
          error,
        }),
      );
    };

    const killProcess = createKillProcess(
      {
        pid: child.pid,
        kill: (signal) => child.kill(signal),
      },
      input.detached,
    );

    const onStdoutData = (chunk: unknown) => appendStdout(state, input, toBuffer(chunk));
    const onStderrData = (chunk: unknown) => appendStderr(state, input, toBuffer(chunk));

    child.stdout?.on('data', onStdoutData);
    child.stderr?.on('data', onStderrData);

    child.on('error', (error: any) => {
      if (aborted) {
        settle(null, null);
        return;
      }
      settle(-1, null, { code: error?.code, message: String(error?.message ?? error) });
    });

    child.on('close', (code, signal) => {
      settle(code, normalizeSignal(signal));
    });

    writeInput(child.stdin ?? {}, input.stdin);

    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
      const killGraceMs = input.killGraceMs ?? 2000;
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killProcess('SIGTERM');
        killTimer = setTimeout(() => killProcess('SIGKILL'), killGraceMs);
      }, input.timeoutMs);
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
  if (getBunRuntime()) {
    return await spawnWithBun(input);
  }
  return await spawnWithNode(input);
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  const bun = getBunRuntime();
  if (bun?.which) {
    return Boolean(bun.which(command));
  }
  const result = await spawnCommand({
    command,
    args: ['--version'],
    timeoutMs: 1500,
    windowsHide: true,
  });
  if (!result.failure) return result.code === 0;
  if (result.failure.kind === 'spawn_error') {
    const code = result.failure.code?.toLowerCase() ?? '';
    if (code === 'enoent') return false;
    return !/not found|enoent/i.test(result.failure.message);
  }
  return result.code === 0;
}
