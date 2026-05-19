export type ProcessFailureKind = 'spawn_error' | 'timeout' | 'aborted' | 'nonzero_exit';

export interface ProcessFailure {
  kind: ProcessFailureKind;
  message: string;
  code?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  command: string;
  args: string[];
}

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
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  onStdoutChunk?: (chunk: Uint8Array) => void;
  onStderrChunk?: (chunk: Uint8Array) => void;
}

export interface SpawnCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted?: boolean;
  error?: { code?: string; message: string };
  failure?: ProcessFailure;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface SpawnInteractiveInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  detached?: boolean;
  windowsHide?: boolean;
}

export type InteractiveProcessEvent = 'error' | 'exit' | 'close' | 'spawn';

export interface InteractiveWritable {
  write?: (data: Buffer | string) => boolean | void;
  end?: () => void;
  on?: (event: 'error' | 'drain', listener: (...args: unknown[]) => void) => InteractiveWritable;
  once?: (event: 'error' | 'drain', listener: (...args: unknown[]) => void) => InteractiveWritable;
  off?: (event: 'error' | 'drain', listener: (...args: unknown[]) => void) => InteractiveWritable;
}

export interface InteractiveProcess {
  pid?: number;
  exitCode?: number | null;
  stdin?: InteractiveWritable;
  stdout?: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream;
  kill: (signal?: NodeJS.Signals) => void;
  on: (
    event: InteractiveProcessEvent,
    listener: (...args: unknown[]) => void,
  ) => InteractiveProcess;
  once: (
    event: InteractiveProcessEvent,
    listener: (...args: unknown[]) => void,
  ) => InteractiveProcess;
  off: (
    event: InteractiveProcessEvent,
    listener: (...args: unknown[]) => void,
  ) => InteractiveProcess;
}
