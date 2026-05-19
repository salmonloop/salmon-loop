import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { LIMITS } from '../../config/limits.js';
import { getLogger } from '../../observability/logger.js';
import { PACKAGE_VERSION } from '../../version.js';

import { McpExecutionResult, McpServerConfig, McpToolDefinition } from './types.js';

/**
 * Thin SalmonLoop adapter around the official MCP TypeScript SDK.
 *
 * Protocol details such as initialization, JSON-RPC framing, stdio process IO,
 * Streamable HTTP/SSE handling, and session cleanup are owned by the SDK.
 */
export class McpClient {
  private client: Client | null = null;
  private transport: Transport | null = null;

  constructor(private config: McpServerConfig) {}

  private isHttp(): boolean {
    return Boolean(this.config.url);
  }

  async start(): Promise<void> {
    if (this.client) return;

    const transport = this.createTransport();
    const client = new Client(
      { name: 'salmon-loop', version: PACKAGE_VERSION },
      { capabilities: {} },
    );

    client.onerror = (error) => {
      getLogger().error(`MCP client error (${this.config.name}): ${error.message}`);
    };
    client.fallbackNotificationHandler = async (notification) => {
      getLogger().debug(
        `Received MCP notification: ${notification.method} (server: ${this.config.name})`,
      );
    };
    client.fallbackRequestHandler = async (request) => {
      getLogger().debug(`Received MCP request: ${request.method} (server: ${this.config.name})`);
      return {};
    };

    if (this.isHttp()) {
      getLogger().info(`Connecting to MCP server: ${this.config.name} (url: ${this.config.url})`);
    } else {
      getLogger().info(
        `Starting MCP server: ${this.config.name} (command: ${this.config.command})`,
      );
    }

    await client.connect(transport, { timeout: LIMITS.defaultToolTimeoutMs });

    this.client = client;
    this.transport = transport;
    getLogger().info(`MCP server ${this.config.name} ready.`);
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const client = this.requireClient();
    const response = await client.listTools(undefined, {
      timeout: LIMITS.defaultToolTimeoutMs,
    });
    return response.tools as McpToolDefinition[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpExecutionResult> {
    const client = this.requireClient();
    const response = await client.callTool({ name, arguments: args }, CallToolResultSchema, {
      timeout: LIMITS.defaultToolTimeoutMs,
    });
    return response as McpExecutionResult;
  }

  async stop(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;

    if (!client) return;

    try {
      const maybeHttpTransport = transport as { terminateSession?: () => Promise<void> };
      if (typeof maybeHttpTransport.terminateSession === 'function') {
        await maybeHttpTransport.terminateSession().catch(() => undefined);
      }
      await client.close();
    } catch {
      // best-effort cleanup
    }
  }

  private createTransport(): Transport {
    if (this.isHttp()) {
      return new StreamableHTTPClientTransport(new URL(this.config.url!), {
        requestInit: {
          headers: this.config.headers ?? {},
        },
      });
    }

    const inheritedEnv = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => {
        return typeof entry[1] === 'string';
      }),
    );
    const transport = new StdioClientTransport({
      command: this.config.command!,
      args: this.config.args ?? [],
      env: { ...inheritedEnv, ...(this.config.env ?? {}) },
      cwd: this.config.cwd,
      // SDK default is "inherit"; keep stderr private so protocol/UI output stays sanitized.
      stderr: 'pipe',
    });
    transport.stderr?.on('data', () => {});
    return transport;
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error(`MCP client ${this.config.name} is not started`);
    }
    return this.client;
  }
}
