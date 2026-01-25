import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';

import { logger } from '../../logger';

import { McpServerConfig, McpExecutionResult } from './types';

/**
 * MCP Client handling JSON-RPC communication over stdio with an external server.
 */
export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void }
  >();
  private rl: Interface | null = null;

  constructor(private config: McpServerConfig) {}

  /**
   * Starts the MCP server process and performs the initialization handshake.
   */
  async start(): Promise<void> {
    logger.info(`Starting MCP server: ${this.config.name} (command: ${this.config.command})`);

    this.process = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...(this.config.env as any) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    if (!this.process) {
      throw new Error(`Failed to spawn MCP server process: ${this.config.name}`);
    }

    this.process.on('error', (err) => {
      logger.error(`MCP process error (${this.config.name}): ${err}`);
    });

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        logger.error(`MCP server ${this.config.name} exited with code ${code}`);
      }
    });

    this.rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    this.rl.on('line', (line) => this.handleMessage(line));

    // Step 1: Initialize handshake
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'salmon-loop', version: '0.2.0' },
    });

    // Step 2: Signal initialized
    await this.notification('notifications/initialized', {});

    logger.info(`MCP server ${this.config.name} ready.`);
  }

  /**
   * Retrieves the list of tools provided by the MCP server.
   */
  async listTools(): Promise<any[]> {
    const response: any = await this.request('tools/list', {});
    return response.tools || [];
  }

  /**
   * Executes a tool on the MCP server.
   */
  async callTool(name: string, args: any): Promise<McpExecutionResult> {
    return (await this.request('tools/call', { name, arguments: args })) as McpExecutionResult;
  }

  private async request(method: string, params: any): Promise<unknown> {
    if (!this.process || !this.process.stdin) {
      throw new Error(`MCP client ${this.config.name} is not started`);
    }

    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process!.stdin!.write(message);

      // Default timeout for MCP requests
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new Error(`MCP Request ${id} (${method}) to ${this.config.name} timed out after 30s`),
          );
        }
      }, 30000);
    });
  }

  private async notification(method: string, params: any): Promise<void> {
    if (!this.process || !this.process.stdin) return;
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
        logger.debug(
          `Received MCP notification/request: ${message.method} (server: ${this.config.name})`,
        );
      }
    } catch (err) {
      logger.error(`Failed to parse MCP message from ${this.config.name}: ${err} (line: ${line})`);
    }
  }

  async stop() {
    this.rl?.close();
    this.process?.kill();
    this.process = null;
    this.pendingRequests.clear();
  }
}
