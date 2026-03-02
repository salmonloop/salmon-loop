import type { AgentSideConnection, TerminalHandle } from '@agentclientprotocol/sdk';

import type { CommandRunner } from '../../runtime/command-runner-context.js';
import type {
  ProcessFailure,
  SpawnCommandInput,
  SpawnCommandResult,
} from '../../runtime/process-types.js';

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFailure(
  input: SpawnCommandInput,
  params: Omit<ProcessFailure, 'command' | 'args'>,
): ProcessFailure {
  return {
    command: input.command,
    args: input.args ?? [],
    ...params,
  };
}

function finalizeResult(params: {
  input: SpawnCommandInput;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error?: { code?: string; message: string };
}): SpawnCommandResult {
  const { input } = params;
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
    stdout: params.stdout,
    stderr: params.stderr,
    stdoutTruncated: params.stdoutTruncated,
    stderrTruncated: params.stderrTruncated,
  };
}

function computeOutputByteLimit(input: SpawnCommandInput): number | null {
  const stdoutLimit = input.maxStdoutBytes ?? null;
  const stderrLimit = input.maxStderrBytes ?? null;

  const candidates = [stdoutLimit, stderrLimit].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (candidates.length === 0) return null;

  // ACP terminal output is a single combined buffer; use the larger budget.
  return Math.max(...candidates);
}

async function safeRelease(terminal: TerminalHandle): Promise<void> {
  try {
    await terminal.release();
  } catch {
    // Ignore release errors.
  }
}

export function createAcpCommandRunner(params: {
  conn: AgentSideConnection;
  sessionId: string;
  pollIntervalMs?: number;
}): CommandRunner {
  const pollIntervalMs = params.pollIntervalMs ?? 10;

  return {
    async isCommandAvailable() {
      // Platform detection is host-specific and not part of ACP capabilities.
      // In strict hosted mode we rely on real execution results.
      return true;
    },

    async spawnCommand(input) {
      let terminal: TerminalHandle | null = null;

      let stdout = '';
      let stdoutTruncated = false;
      const stderr = '';
      const stderrTruncated = false;

      let timedOut = false;
      let aborted = Boolean(input.signal?.aborted);
      let code: number | null = null;
      let signal: NodeJS.Signals | null = null;

      const start = Date.now();
      const timeoutMs =
        typeof input.timeoutMs === 'number' &&
        Number.isFinite(input.timeoutMs) &&
        input.timeoutMs > 0
          ? input.timeoutMs
          : null;

      function emitDelta(next: string) {
        if (next === stdout) return;
        if (next.startsWith(stdout)) {
          const delta = next.slice(stdout.length);
          if (delta) input.onStdoutChunk?.(Buffer.from(delta, 'utf8'));
          stdout = next;
          return;
        }

        // Output was truncated/rotated by the host; emit the whole buffer as a reset.
        input.onStdoutChunk?.(Buffer.from(next, 'utf8'));
        stdout = next;
      }

      try {
        terminal = await params.conn.createTerminal({
          sessionId: params.sessionId,
          command: input.command,
          args: input.args ?? [],
          cwd: input.cwd ?? undefined,
          env: input.env ?? undefined,
          outputByteLimit: computeOutputByteLimit(input),
        } as any);

        while (true) {
          aborted = aborted || Boolean(input.signal?.aborted);
          if (aborted) {
            try {
              await terminal.kill();
            } catch {
              // Ignore kill errors.
            }
            break;
          }

          if (timeoutMs !== null && Date.now() - start > timeoutMs) {
            timedOut = true;
            try {
              await terminal.kill();
            } catch {
              // Ignore kill errors.
            }
            break;
          }

          const out = await terminal.currentOutput();
          emitDelta(out.output);
          stdoutTruncated = stdoutTruncated || Boolean(out.truncated);

          if (out.exitStatus) {
            code = out.exitStatus.exitCode ?? null;
            signal = (out.exitStatus.signal ?? null) as NodeJS.Signals | null;
            break;
          }

          await sleep(pollIntervalMs);
        }

        if (code === null && !timedOut && !aborted) {
          const exit = await terminal.waitForExit();
          code = exit.exitCode ?? null;
          signal = (exit.signal ?? null) as NodeJS.Signals | null;
          const out = await terminal.currentOutput();
          emitDelta(out.output);
          stdoutTruncated = stdoutTruncated || Boolean(out.truncated);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return finalizeResult({
          input,
          stdout,
          stderr,
          code,
          signal,
          timedOut,
          aborted,
          stdoutTruncated,
          stderrTruncated,
          error: { message },
        });
      } finally {
        if (terminal) await safeRelease(terminal);
      }

      return finalizeResult({
        input,
        stdout,
        stderr,
        code,
        signal,
        timedOut,
        aborted,
        stdoutTruncated,
        stderrTruncated,
      });
    },
  };
}
