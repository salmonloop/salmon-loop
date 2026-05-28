import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolResultSchema,
  type ClientCapabilities,
  PromptListChangedNotificationSchema,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
  GetPromptResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { LIMITS } from '../../config/limits.js';
import { getLogger } from '../../observability/logger.js';
import { PACKAGE_VERSION } from '../../version.js';
import { discoverMcpCatalog } from '../catalog/discovery.js';
import { McpNotificationRouter } from '../catalog/notification-router.js';
import type {
  McpCatalogSnapshot,
  McpClientCapabilitiesInput,
  McpConnectionStatus,
  McpConnectionView,
  ResolvedMcpServerV2,
} from '../types.js';

import { createMcpTransport } from './transport-factory.js';

type ManagedConnection = {
  server: ResolvedMcpServerV2;
  client: Client;
  transport: Transport;
  status: McpConnectionStatus;
  catalog?: McpCatalogSnapshot;
  staleKinds: Set<'tools' | 'resources' | 'resourceTemplates' | 'prompts'>;
  subscribedResources: Set<string>;
  error?: string;
};

export interface McpResourceUpdatedEvent {
  serverName: string;
  uri: string;
}

function buildClientCapabilities(input?: McpClientCapabilitiesInput): ClientCapabilities {
  const capabilities: ClientCapabilities = {
    roots: input?.roots ? { listChanged: true } : undefined,
    sampling: input?.sampling ? {} : undefined,
    elicitation: input?.elicitation ? { form: {} } : undefined,
  };
  return capabilities;
}

export class McpConnectionManager {
  private connections = new Map<string, ManagedConnection>();
  private resourceUpdateHandlers: Array<(event: McpResourceUpdatedEvent) => void | Promise<void>> =
    [];
  readonly notifications = new McpNotificationRouter();

  constructor(
    private readonly servers: ResolvedMcpServerV2[],
    private readonly clientCapabilities?: McpClientCapabilitiesInput,
  ) {
    this.notifications.onInvalidate((event) => {
      this.markStale(event.serverName, event.kind);
    });
  }

  async startAll(): Promise<void> {
    for (const server of this.servers) {
      if (!server.enabled) continue;
      await this.connect(server);
    }
  }

  async connect(server: ResolvedMcpServerV2): Promise<McpConnectionView> {
    const existing = this.connections.get(server.name);
    if (existing && existing.status === 'ready') return this.view(existing);

    const transport = createMcpTransport(server);
    const client = new Client(
      { name: 'salmon-loop', version: PACKAGE_VERSION },
      { capabilities: buildClientCapabilities(this.clientCapabilities) },
    );
    const entry: ManagedConnection = {
      server,
      client,
      transport,
      status: 'connecting',
      staleKinds: new Set(),
      subscribedResources: new Set(),
    };
    this.connections.set(server.name, entry);

    client.onerror = (error) => {
      entry.status = 'degraded';
      entry.error = error.message;
      this.markStale(server.name, 'tools');
      this.markStale(server.name, 'resources');
      this.markStale(server.name, 'prompts');
      getLogger().warn(`MCP server ${server.name} degraded: ${error.message}`);
    };
    client.onclose = () => {
      if (entry.status === 'closed') return;
      entry.status = 'degraded';
      entry.error = `MCP server ${server.name} connection closed`;
      this.markStale(server.name, 'tools');
      this.markStale(server.name, 'resources');
      this.markStale(server.name, 'prompts');
    };
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      await this.notifications.invalidate({ serverName: server.name, kind: 'tools' });
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      await this.notifications.invalidate({ serverName: server.name, kind: 'resources' });
    });
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
      const uri = notification.params?.uri;
      if (typeof uri !== 'string') return;
      await this.emitResourceUpdated({ serverName: server.name, uri });
    });
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      await this.notifications.invalidate({ serverName: server.name, kind: 'prompts' });
    });
    client.fallbackNotificationHandler = async (notification) => {
      await this.notifications.route({ serverName: server.name, method: notification.method });
    };

    try {
      await client.connect(transport, { timeout: LIMITS.defaultToolTimeoutMs });
      entry.catalog = await discoverMcpCatalog({ server, client });
      entry.status = 'ready';
      entry.error = undefined;
      entry.staleKinds.clear();
    } catch (error) {
      entry.status = 'degraded';
      entry.error = error instanceof Error ? error.message : String(error);
      getLogger().warn(`Failed to connect MCP server ${server.name}: ${entry.error}`);
    }

    return this.view(entry);
  }

  getCatalog(serverName: string): McpCatalogSnapshot | undefined {
    return this.connections.get(serverName)?.catalog;
  }

  listCatalogs(): McpCatalogSnapshot[] {
    return Array.from(this.connections.values())
      .map((entry) => entry.catalog)
      .filter((catalog): catalog is McpCatalogSnapshot => Boolean(catalog));
  }

  async refreshCatalog(serverName: string): Promise<McpCatalogSnapshot> {
    const entry = this.requireReady(serverName);
    entry.catalog = await discoverMcpCatalog({ server: entry.server, client: entry.client });
    entry.staleKinds.clear();
    return entry.catalog;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) {
    const entry = this.requireReady(serverName);
    return entry.client.callTool({ name: toolName, arguments: args }, CallToolResultSchema, {
      timeout: LIMITS.defaultToolTimeoutMs,
      signal: options?.signal,
    });
  }

  async readResource(serverName: string, uri: string) {
    const entry = this.requireReady(serverName);
    return entry.client
      .readResource({ uri }, { timeout: LIMITS.defaultToolTimeoutMs })
      .then((result) => {
        const parsed = ReadResourceResultSchema.parse(result);
        return this.ensureResourceSubscription(entry, uri).then(() => parsed);
      });
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, string>) {
    const entry = this.requireReady(serverName);
    return entry.client
      .getPrompt({ name, arguments: args }, { timeout: LIMITS.defaultToolTimeoutMs })
      .then((result) => GetPromptResultSchema.parse(result));
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.connections.values()).map((entry) => this.stopEntry(entry)));
    this.connections.clear();
  }

  async stop(serverName: string): Promise<void> {
    const entry = this.connections.get(serverName);
    if (!entry) return;
    await this.stopEntry(entry);
    this.connections.delete(serverName);
  }

  views(): McpConnectionView[] {
    return Array.from(this.connections.values()).map((entry) => this.view(entry));
  }

  onResourceUpdated(handler: (event: McpResourceUpdatedEvent) => void | Promise<void>): () => void {
    this.resourceUpdateHandlers.push(handler);
    return () => {
      this.resourceUpdateHandlers = this.resourceUpdateHandlers.filter(
        (entry) => entry !== handler,
      );
    };
  }

  private markStale(
    serverName: string,
    kind: 'tools' | 'resources' | 'resourceTemplates' | 'prompts',
  ) {
    const entry = this.connections.get(serverName);
    if (!entry) return;
    entry.staleKinds.add(kind);
    if (kind === 'resources') entry.staleKinds.add('resourceTemplates');
    if (entry.catalog) entry.catalog = { ...entry.catalog, stale: true };
  }

  private requireReady(serverName: string): ManagedConnection {
    const entry = this.connections.get(serverName);
    if (!entry || entry.status !== 'ready') {
      throw new Error(`MCP server ${serverName} is not ready`);
    }
    return entry;
  }

  private async ensureResourceSubscription(entry: ManagedConnection, uri: string): Promise<void> {
    if (!entry.server.capabilities.resources.subscribe) return;
    if (!entry.client.getServerCapabilities()?.resources?.subscribe) return;
    if (entry.subscribedResources.has(uri)) return;

    try {
      await entry.client.subscribeResource({ uri }, { timeout: LIMITS.defaultToolTimeoutMs });
      entry.subscribedResources.add(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().warn(
        `MCP server ${entry.server.name} resource subscription failed for ${uri}: ${message}`,
      );
    }
  }

  private async emitResourceUpdated(event: McpResourceUpdatedEvent): Promise<void> {
    for (const handler of this.resourceUpdateHandlers) {
      await handler(event);
    }
  }

  private async unsubscribeResources(entry: ManagedConnection): Promise<void> {
    if (entry.subscribedResources.size === 0) return;
    if (!entry.server.capabilities.resources.subscribe) {
      entry.subscribedResources.clear();
      return;
    }
    if (!entry.client.getServerCapabilities()?.resources?.subscribe) {
      entry.subscribedResources.clear();
      return;
    }

    for (const uri of entry.subscribedResources) {
      try {
        await entry.client.unsubscribeResource({ uri }, { timeout: LIMITS.defaultToolTimeoutMs });
      } catch {
        // best-effort unsubscribe during shutdown
      }
    }
    entry.subscribedResources.clear();
  }

  private async stopEntry(entry: ManagedConnection): Promise<void> {
    entry.status = 'closed';
    try {
      await this.unsubscribeResources(entry);
      const maybeHttpTransport = entry.transport as { terminateSession?: () => Promise<void> };
      if (typeof maybeHttpTransport.terminateSession === 'function') {
        await maybeHttpTransport.terminateSession().catch(() => undefined);
      }
      await entry.client.close();
    } catch {
      // best-effort shutdown
    }
  }

  private view(entry: ManagedConnection): McpConnectionView {
    return {
      serverName: entry.server.name,
      status: entry.status,
      capabilities: entry.client.getServerCapabilities(),
      error: entry.error,
    };
  }
}
