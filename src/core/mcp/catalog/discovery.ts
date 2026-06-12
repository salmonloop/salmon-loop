import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Prompt, Resource, ResourceTemplate, Tool } from '@modelcontextprotocol/sdk/types.js';

import { getLogger } from '../../observability/logger.js';
import type { McpCatalogSnapshot, ResolvedMcpServerV2 } from '../types.js';

import { withPromptServer } from './prompt-catalog.js';
import { withResourceServer, withResourceTemplateServer } from './resource-catalog.js';
import { withToolServer } from './tool-catalog.js';

async function safeList<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    getLogger().debug(
      `[McpDiscovery] safeList call failed, returning fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fallback;
  }
}

export async function discoverMcpCatalog(params: {
  server: ResolvedMcpServerV2;
  client: Client;
}): Promise<McpCatalogSnapshot> {
  const capabilities = params.client.getServerCapabilities();
  const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
    capabilities?.tools
      ? safeList(() => listAllPages<Tool>((cursor) => params.client.listTools(cursor)), [])
      : [],
    capabilities?.resources
      ? safeList(() => listAllPages<Resource>((cursor) => params.client.listResources(cursor)), [])
      : [],
    capabilities?.resources
      ? safeList(
          () =>
            listAllPages<ResourceTemplate>((cursor) => params.client.listResourceTemplates(cursor)),
          [],
        )
      : [],
    capabilities?.prompts
      ? safeList(() => listAllPages<Prompt>((cursor) => params.client.listPrompts(cursor)), [])
      : [],
  ]);

  return {
    serverName: params.server.name,
    capabilities,
    tools: withToolServer(params.server.name, toolsResult as unknown as Record<string, unknown>[]),
    resources: withResourceServer(
      params.server.name,
      resourcesResult as unknown as Record<string, unknown>[],
    ),
    resourceTemplates: withResourceTemplateServer(
      params.server.name,
      templatesResult as unknown as Record<string, unknown>[],
    ),
    prompts: withPromptServer(
      params.server.name,
      promptsResult as unknown as Record<string, unknown>[],
    ),
    refreshedAt: new Date().toISOString(),
    stale: false,
  };
}

async function listAllPages<T>(
  fetchPage: (params?: { cursor?: string }) => Promise<Record<string, unknown>>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchPage(cursor ? { cursor } : undefined);
    const values = page.tools ?? page.resources ?? page.resourceTemplates ?? page.prompts;
    if (Array.isArray(values)) items.push(...(values as T[]));
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
  } while (cursor);

  return items;
}
