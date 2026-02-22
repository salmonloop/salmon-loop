import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { getBunRuntime, normalizeSignal, toNodeReadableStream } from './bun-runtime.js';
import { InteractiveProcess, SpawnInteractiveInput } from './process-types.js';

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
