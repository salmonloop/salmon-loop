import { PassThrough, type Readable } from 'node:stream';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { spawnInteractiveProcess, type InteractiveProcess } from '../../runtime/process-runner.js';
import type { ResolvedMcpServerV2 } from '../types.js';

export function buildStrictStdioEnvironment(env: Record<string, string>): Record<string, string> {
  return { ...env };
}

export class StrictStdioClientTransport implements Transport {
  private child?: InteractiveProcess;
  private readonly readBuffer = new ReadBuffer();
  private readonly stderrStream = new PassThrough();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly server: {
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
    },
  ) {}

  get stderr(): Readable {
    return this.stderrStream;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  async start(): Promise<void> {
    if (this.child) {
      throw new Error('StrictStdioClientTransport already started');
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawnInteractiveProcess({
        command: this.server.command,
        args: this.server.args,
        cwd: this.server.cwd,
        env: buildStrictStdioEnvironment(this.server.env),
        windowsHide: true,
      });
      this.child = child;

      const failStart = (error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        if (!settled) {
          settled = true;
          reject(normalizedError);
        }
        this.onerror?.(normalizedError);
      };

      child.once('error', failStart);
      child.once('spawn', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      child.once('close', () => {
        this.child = undefined;
        this.onclose?.();
      });
      if (!child.stdin || !child.stdout) {
        failStart(new Error('MCP stdio transport failed to open stdio streams'));
        return;
      }
      child.stdin?.on?.('error', (error) =>
        this.onerror?.(error instanceof Error ? error : new Error(String(error))),
      );
      child.stdout.on('data', (chunk: Buffer) => {
        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });
      child.stdout.on('error', (error) =>
        this.onerror?.(error instanceof Error ? error : new Error(String(error))),
      );
      child.stderr?.pipe(this.stderrStream, { end: false });
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.readBuffer.clear();
      return;
    }

    this.child = undefined;
    const closePromise = new Promise<void>((resolve) => {
      child.once('close', () => resolve());
    });

    try {
      child.stdin?.end?.();
    } catch {
      // best-effort shutdown
    }

    await Promise.race([closePromise, unrefTimeout(2_000)]);

    if (child.exitCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {
        // best-effort shutdown
      }
      await Promise.race([closePromise, unrefTimeout(2_000)]);
    }

    if (child.exitCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // best-effort shutdown
      }
    }

    this.readBuffer.clear();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const child = this.child;
    if (!child) throw new Error('MCP stdio transport is not connected');
    const stdin = child.stdin;
    if (!stdin) throw new Error('MCP stdio transport stdin is not available');

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        stdin.off?.('error', onError as (...args: unknown[]) => void);
        reject(error);
      };
      stdin.once?.('error', onError as (...args: unknown[]) => void);
      if (stdin.write?.(serializeMessage(message))) {
        stdin.off?.('error', onError as (...args: unknown[]) => void);
        resolve();
        return;
      }
      stdin.once?.('drain', () => {
        stdin.off?.('error', onError as (...args: unknown[]) => void);
        resolve();
      });
    });
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

export function createMcpTransport(server: ResolvedMcpServerV2): Transport {
  if (server.transport.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(server.transport.url), {
      requestInit: {
        headers: server.transport.headers,
      },
    });
  }

  const transport = new StrictStdioClientTransport({
    command: server.transport.command,
    args: server.transport.args,
    env: server.transport.env,
    cwd: server.transport.cwd,
  });
  transport.stderr.on('data', () => {});
  return transport;
}

function unrefTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
