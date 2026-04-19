import { createInterface, Interface } from 'readline';

import { LIMITS } from '../../config/limits.js';
import { getLogger } from '../../observability/logger.js';
import { InteractiveProcess, spawnInteractiveProcess } from '../../runtime/process-runner.js';

import {
  assertOk,
  createMcpHeaders,
  decodeSseEvents,
  delayMs,
  isEventStreamResponse,
  safeDrainResponse,
} from './streamable-http.js';
import { McpExecutionResult, McpServerConfig, McpToolDefinition } from './types.js';

/**
 * MCP Client handling JSON-RPC communication over stdio with an external server.
 */
export class McpClient {
  private process: InteractiveProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private rl: Interface | null = null;
  private sessionId: string | undefined;

  constructor(private config: McpServerConfig) {}

  private isHttp(): boolean {
    return Boolean(this.config.url);
  }

  /**
   * Starts the MCP server process and performs the initialization handshake.
   */
  async start(): Promise<void> {
    if (this.isHttp()) {
      getLogger().info(`Connecting to MCP server: ${this.config.name} (url: ${this.config.url})`);
      await this.initialize();
      getLogger().info(`MCP server ${this.config.name} ready.`);
      return;
    }

    getLogger().info(`Starting MCP server: ${this.config.name} (command: ${this.config.command})`);
    this.process = spawnInteractiveProcess({
      command: this.config.command!,
      args: this.config.args || [],
      env: { ...process.env, ...(this.config.env as Record<string, string>) },
      cwd: this.config.cwd,
      // Never inherit stderr into the parent TTY: it bypasses UI sanitization and can leak raw errors.
      windowsHide: true,
    });

    if (!this.process) {
      throw new Error(`Failed to spawn MCP server process: ${this.config.name}`);
    }

    this.process.on('error', (err) => {
      getLogger().error(`MCP process error (${this.config.name}): ${err}`);
    });

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        getLogger().error(`MCP server ${this.config.name} exited with code ${code}`);
      }
    });

    this.rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    this.rl.on('line', (line) => this.handleMessage(line));
    // Drain stderr to avoid backpressure deadlocks, but do not surface raw output to UI.
    this.process.stderr?.on('data', () => {});

    await this.initialize();

    getLogger().info(`MCP server ${this.config.name} ready.`);
  }

  /**
   * Retrieves the list of tools provided by the MCP server.
   */
  async listTools(): Promise<McpToolDefinition[]> {
    const response = await this.request<{ tools?: McpToolDefinition[] }>('tools/list', {});
    return response.tools || [];
  }

  /**
   * Executes a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpExecutionResult> {
    return await this.request<McpExecutionResult>('tools/call', { name, arguments: args });
  }

  private async initialize(): Promise<void> {
    // Step 1: Initialize handshake
    await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'salmon-loop', version: '0.2.0' },
    });

    // Step 2: Signal initialized
    await this.notification('notifications/initialized', {});
  }

  private async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.isHttp()) {
      return (await this.requestHttp(method, params)) as T;
    }
    if (!this.process?.stdin?.write) {
      throw new Error(`MCP client ${this.config.name} is not started`);
    }

    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      this.process!.stdin!.write!(message);

      // Default timeout for MCP requests
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new Error(
              `MCP Request ${id} (${method}) to ${this.config.name} timed out after ${LIMITS.defaultToolTimeoutMs / 1000}s`,
            ),
          );
        }
      }, LIMITS.defaultToolTimeoutMs);
    });
  }

  private async notification(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.isHttp()) {
      await this.notificationHttp(method, params);
      return;
    }
    if (!this.process?.stdin?.write) return;
    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(message);
  }

  private handleMessage(line: string) {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);

      // Handle JSON-RPC Response
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const { resolve, reject } = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);

        if (message.error) {
          reject(new Error(`MCP Error [${message.error.code}]: ${message.error.message}`));
        } else {
          resolve(message.result);
        }
      }
      // Handle Notifications/Requests from Server (Optional, future proofing)
      else if (message.method) {
        getLogger().debug(
          `Received MCP notification/request: ${message.method} (server: ${this.config.name})`,
        );
      }
    } catch (err) {
      getLogger().error(
        `Failed to parse MCP message from ${this.config.name}: ${err} (line: ${line})`,
      );
    }
  }

  async stop() {
    if (this.isHttp()) {
      await this.stopHttp();
      return;
    }
    this.rl?.close();
    this.process?.kill();
    this.process = null;
    this.pendingRequests.clear();
  }

  private async requestHttp(method: string, params: Record<string, unknown>): Promise<unknown> {
    const url = this.config.url!;
    const headers = this.config.headers ?? {};

    const id = ++this.requestId;
    const payload = { jsonrpc: '2.0', id, method, params };

    const timeoutMs = LIMITS.defaultToolTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: createMcpHeaders({ sessionId: this.sessionId, extra: headers }),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) this.sessionId = newSessionId;

      assertOk(response, `MCP request ${id} (${method}) to ${this.config.name}`);

      if (!isEventStreamResponse(response)) {
        const message = (await response.json()) as Record<string, unknown>;
        if (message && typeof message === 'object' && message.error) {
          const err = message.error as Record<string, unknown>;
          throw new Error(`MCP Error [${err.code}]: ${err.message}`);
        }
        return message?.result;
      }

      let lastEventId: string | undefined;
      let retryMs = 1000;

      // Streamable HTTP can require reconnect (via GET + Last-Event-ID) to resume a dropped stream.
      let streamResponse: Response = response;
      while (true) {
        if (!streamResponse.body) {
          throw new Error(`MCP SSE response missing body (${this.config.name})`);
        }

        for await (const event of decodeSseEvents(streamResponse.body)) {
          if (event.id) lastEventId = event.id;
          if (typeof event.retry === 'number') retryMs = Math.max(0, event.retry);
          if (!event.data) continue;

          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;

            if (msg.method) {
              getLogger().debug(
                `Received MCP notification/request: ${msg.method} (server: ${this.config.name})`,
              );
            }

            if (msg.id !== id) continue;

            if (msg.error) {
              const err = msg.error as Record<string, unknown>;
              throw new Error(`MCP Error [${err.code}]: ${err.message}`);
            }
            return msg.result;
          } catch (err) {
            getLogger().error(
              `Failed to parse MCP SSE message from ${this.config.name}: ${String(err)} (data: ${event.data})`,
            );
          }
        }

        // Stream ended without response for this request. Try to resume via GET.
        if (!lastEventId) {
          throw new Error(
            `MCP SSE stream ended before response for request ${id} (${method}) (${this.config.name})`,
          );
        }

        await delayMs(retryMs);

        const resumeController = new AbortController();
        const resumeTimeout = setTimeout(() => resumeController.abort(), timeoutMs);
        try {
          streamResponse = await fetch(url, {
            method: 'GET',
            headers: {
              ...createMcpHeaders({ sessionId: this.sessionId, extra: headers }),
              'Last-Event-ID': lastEventId,
            },
            signal: resumeController.signal,
          });
          const resumedSessionId = streamResponse.headers.get('mcp-session-id');
          if (resumedSessionId) this.sessionId = resumedSessionId;
          assertOk(streamResponse, `MCP SSE resume for ${this.config.name}`);
          if (!isEventStreamResponse(streamResponse)) {
            throw new Error(
              `MCP SSE resume did not return text/event-stream (${this.config.name})`,
            );
          }
        } finally {
          clearTimeout(resumeTimeout);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `MCP Request ${id} (${method}) to ${this.config.name} timed out after ${timeoutMs / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async notificationHttp(method: string, params: Record<string, unknown>): Promise<void> {
    const url = this.config.url!;
    const headers = this.config.headers ?? {};
    const payload = { jsonrpc: '2.0', method, params };

    const timeoutMs = LIMITS.defaultToolTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: createMcpHeaders({ sessionId: this.sessionId, extra: headers }),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) this.sessionId = newSessionId;
      if (!response.ok) {
        await safeDrainResponse(response);
        throw new Error(`MCP notification ${method} failed with HTTP ${response.status}`);
      }
      await safeDrainResponse(response);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `MCP notification ${method} to ${this.config.name} timed out after ${timeoutMs / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async stopHttp(): Promise<void> {
    if (!this.config.url || !this.sessionId) return;
    const timeoutMs = 3000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.config.url, {
        method: 'DELETE',
        headers: createMcpHeaders({
          sessionId: this.sessionId,
          extra: this.config.headers ?? {},
        }),
        signal: controller.signal,
      });
      await safeDrainResponse(response);
    } catch {
      // best-effort cleanup
    } finally {
      clearTimeout(timeout);
      this.sessionId = undefined;
    }
  }
}
