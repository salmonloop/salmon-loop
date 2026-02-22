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

export interface InteractiveProcess {
  pid?: number;
  stdin?: { write?: (data: Buffer | string) => void; end?: () => void };
  stdout?: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream;
  kill: (signal?: NodeJS.Signals) => void;
  on: (event: 'error' | 'exit', listener: (...args: unknown[]) => void) => InteractiveProcess;
}
