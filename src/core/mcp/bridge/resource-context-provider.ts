import { ResourceCache } from '../cache/resource-cache.js';
import type { McpConnectionManager } from '../client/connection-manager.js';
import type { McpPolicyEngine } from '../policy/approval-policy.js';

export type ResourceIncludeIntent = 'required' | 'manual' | 'autoInclude';
export type McpResourceIncludeIntent = ResourceIncludeIntent;

export interface McpResourceMetadata {
  serverName: string;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  includeIntent?: ResourceIncludeIntent;
}

export interface ResourcePolicyCheckInput {
  serverName: string;
  uri: string;
  intent: ResourceIncludeIntent;
}

export interface McpResourceConnection {
  readResource(input: { uri: string }): Promise<{ contents: Array<Record<string, unknown>> }>;
}

export interface McpResourceCatalog {
  listResources(): McpResourceMetadata[];
}

export interface ResourceContextProviderOptions {
  budgetChars?: number;
  maxResourceChars?: number;
  maxResources?: number;
}

export type ResourceContextBlock =
  | {
      type: 'resource_text';
      serverName: string;
      uri: string;
      name?: string;
      mimeType?: string;
      content: { text: string; format: 'text' | 'json' };
      includedChars: number;
      truncated: boolean;
    }
  | {
      type: 'resource_link';
      serverName: string;
      uri: string;
      name?: string;
      reason: 'blob' | 'non_text' | 'budget_exhausted';
      metadata: Record<string, unknown>;
    };

export interface ResourceContextDiagnostic {
  code: string;
  message: string;
  serverName: string;
  uri: string;
  optional: boolean;
}

export class ResourceContextProviderError extends Error {
  constructor(
    message: string,
    public readonly diagnostic: ResourceContextDiagnostic,
  ) {
    super(message);
    this.name = 'ResourceContextProviderError';
  }
}

export interface ResourceContextResult {
  blocks: ResourceContextBlock[];
  diagnostics: ResourceContextDiagnostic[];
  meta: {
    usedChars: number;
    truncated: boolean;
    cacheHits: number;
    cacheMisses: number;
  };
}

export class ResourceContextProvider {
  private readonly cache: ResourceCache<ResourceContextBlock[]>;
  private readonly options: Required<ResourceContextProviderOptions>;

  constructor(
    private readonly deps: {
      catalog: McpResourceCatalog;
      connections: Record<string, McpResourceConnection>;
      policy: {
        checkUri(input: ResourcePolicyCheckInput): boolean | { allowed: boolean; reason?: string };
      };
      cache?: ResourceCache<ResourceContextBlock[]>;
      options?: ResourceContextProviderOptions;
    },
  ) {
    this.cache = deps.cache ?? new ResourceCache<ResourceContextBlock[]>();
    this.options = {
      budgetChars: deps.options?.budgetChars ?? 24_000,
      maxResourceChars: deps.options?.maxResourceChars ?? 8_000,
      maxResources: deps.options?.maxResources ?? 20,
    };
  }

  async provide(input?: {
    resources?: Array<{ serverName: string; uri: string; intent: ResourceIncludeIntent }>;
  }): Promise<ResourceContextResult> {
    const result: ResourceContextResult = {
      blocks: [],
      diagnostics: [],
      meta: { usedChars: 0, truncated: false, cacheHits: 0, cacheMisses: 0 },
    };
    const selected = this.selectResources(input?.resources ?? []);

    for (const resource of selected.slice(0, this.options.maxResources)) {
      const optional = resource.includeIntent !== 'required';
      const policy = this.deps.policy.checkUri({
        serverName: resource.serverName,
        uri: resource.uri,
        intent: resource.includeIntent ?? 'manual',
      });
      const allowed = typeof policy === 'boolean' ? policy : policy.allowed;
      if (!allowed) {
        const diagnostic = this.diagnostic(
          'POLICY_DENIED',
          typeof policy === 'boolean'
            ? 'MCP resource denied by policy'
            : (policy.reason ?? 'MCP resource denied by policy'),
          resource,
          optional,
        );
        if (!optional) throw new ResourceContextProviderError(diagnostic.message, diagnostic);
        result.diagnostics.push(diagnostic);
        continue;
      }

      let remaining = this.options.budgetChars - result.meta.usedChars;
      if (remaining <= 0) {
        result.meta.truncated = true;
        result.blocks.push(this.linkBlock(resource, 'budget_exhausted'));
        continue;
      }

      const cacheKey = `${resource.serverName}:${resource.uri}:${Math.min(
        this.options.maxResourceChars,
        remaining,
      )}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        result.meta.cacheHits += 1;
        result.blocks.push(...cached);
        for (const block of cached) {
          if (block.type === 'resource_text') {
            result.meta.usedChars += block.includedChars;
            result.meta.truncated = result.meta.truncated || block.truncated;
          }
        }
        continue;
      }

      result.meta.cacheMisses += 1;
      try {
        const connection = this.deps.connections[resource.serverName];
        if (!connection) throw new Error(`MCP connection not found: ${resource.serverName}`);
        const read = await connection.readResource({ uri: resource.uri });
        const contents = read.contents ?? [];
        const resourceBlocks: ResourceContextBlock[] = [];
        for (const content of contents) {
          if (remaining <= 0) break;
          const block = this.blockFromRead(resource, content, remaining);
          resourceBlocks.push(block);
          result.blocks.push(block);
          if (block.type === 'resource_text') {
            result.meta.usedChars += block.includedChars;
            result.meta.truncated = result.meta.truncated || block.truncated;
            remaining -= block.includedChars;
          }
        }
        if (resourceBlocks.length > 0) {
          this.cache.set(cacheKey, resourceBlocks);
        }
      } catch (error) {
        const diagnostic = this.diagnostic(
          'READ_FAILED',
          error instanceof Error ? error.message : String(error),
          resource,
          optional,
        );
        if (!optional) throw new ResourceContextProviderError(diagnostic.message, diagnostic);
        result.diagnostics.push(diagnostic);
      }
    }

    return result;
  }

  invalidate(serverName: string, uri: string): void {
    this.cache.deleteMatching((key) => {
      const serverPrefix = `${serverName}:`;
      if (!key.startsWith(serverPrefix)) return false;

      const separatorIndex = key.lastIndexOf(':');
      if (separatorIndex <= serverPrefix.length) return false;

      const cachedUri = key.slice(serverPrefix.length, separatorIndex);
      return cachedUri === uri || uri.startsWith(cachedUri);
    });
  }

  private selectResources(
    manual: Array<{ serverName: string; uri: string; intent: ResourceIncludeIntent }>,
  ): McpResourceMetadata[] {
    const catalog = this.deps.catalog.listResources();
    const resources = catalog.filter(
      (resource) =>
        resource.includeIntent === 'required' || resource.includeIntent === 'autoInclude',
    );
    for (const item of manual) {
      if (
        resources.some(
          (resource) => resource.serverName === item.serverName && resource.uri === item.uri,
        )
      ) {
        continue;
      }
      const catalogResource = catalog.find(
        (resource) => resource.serverName === item.serverName && resource.uri === item.uri,
      );
      resources.push({
        ...catalogResource,
        serverName: item.serverName,
        uri: item.uri,
        includeIntent: item.intent,
      });
    }
    return resources;
  }

  private blockFromRead(
    resource: McpResourceMetadata,
    content: Record<string, unknown> | undefined,
    remainingBudget: number,
  ): ResourceContextBlock {
    if (!content) return this.linkBlock(resource, 'non_text');
    const contentUri = this.contentUri(resource, content);
    const mimeType = typeof content.mimeType === 'string' ? content.mimeType : resource.mimeType;
    if (typeof content.blob === 'string') return this.linkBlock(resource, 'blob', contentUri);
    if (typeof content.text !== 'string') return this.linkBlock(resource, 'non_text', contentUri);
    if (!isTextMime(mimeType)) return this.linkBlock(resource, 'non_text', contentUri);

    const raw = normalizeText(content.text, mimeType);
    const limit = Math.max(0, Math.min(this.options.maxResourceChars, remainingBudget));
    const truncated = raw.length > limit;
    const text = truncated ? raw.slice(0, limit) : raw;
    return {
      type: 'resource_text',
      serverName: resource.serverName,
      uri: contentUri,
      name: resource.name,
      mimeType,
      content: { text, format: isJsonMime(mimeType) ? 'json' : 'text' },
      includedChars: text.length,
      truncated,
    };
  }

  private linkBlock(
    resource: McpResourceMetadata,
    reason: 'blob' | 'non_text' | 'budget_exhausted',
    uri = resource.uri,
  ): ResourceContextBlock {
    return {
      type: 'resource_link',
      serverName: resource.serverName,
      uri,
      name: resource.name,
      reason,
      metadata: {
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        size: resource.size,
      },
    };
  }

  private contentUri(resource: McpResourceMetadata, content: Record<string, unknown>): string {
    return typeof content.uri === 'string' ? content.uri : resource.uri;
  }

  private diagnostic(
    code: string,
    message: string,
    resource: McpResourceMetadata,
    optional: boolean,
  ): ResourceContextDiagnostic {
    return {
      code,
      message,
      serverName: resource.serverName,
      uri: resource.uri,
      optional,
    };
  }
}

export class McpResourceContextProvider {
  private readonly provider: ResourceContextProvider;

  constructor(manager: McpConnectionManager, policy: McpPolicyEngine) {
    this.provider = new ResourceContextProvider({
      catalog: {
        listResources: () =>
          manager.listCatalogs().flatMap((catalog) =>
            catalog.resources.map((resource) => ({
              serverName: catalog.serverName,
              uri: resource.uri,
              name: resource.name,
              description: resource.description,
              mimeType: resource.mimeType,
              includeIntent: 'autoInclude' as const,
            })),
          ),
      },
      connections: new Proxy(
        {},
        {
          get: (_target, serverName: string) => ({
            readResource: ({ uri }: { uri: string }) => manager.readResource(serverName, uri),
          }),
        },
      ) as Record<string, McpResourceConnection>,
      policy: {
        checkUri: ({ serverName, uri }) => {
          const decision = policy.decideResource({ server: serverName, uri });
          return { allowed: decision.allowed, reason: decision.denyReason ?? decision.reason };
        },
      },
    });
    manager.onResourceUpdated((event) => {
      this.provider.invalidate(event.serverName, event.uri);
    });
  }

  async read(input: {
    server: string;
    uri: string;
    intent: McpResourceIncludeIntent;
    maxBytes: number;
    ttlMs: number;
  }) {
    const result = await this.provider.provide({
      resources: [{ serverName: input.server, uri: input.uri, intent: input.intent }],
    });
    const block = result.blocks[0];
    if (!block) {
      return {
        server: input.server,
        uri: input.uri,
        diagnostics: result.diagnostics[0]?.message,
      };
    }
    if (block.type === 'resource_text') {
      return {
        server: input.server,
        uri: input.uri,
        mimeType: block.mimeType,
        text: block.content.text,
        truncated: block.truncated,
      };
    }
    return {
      server: input.server,
      uri: input.uri,
      mimeType: typeof block.metadata.mimeType === 'string' ? block.metadata.mimeType : undefined,
      linkOnly: true,
    };
  }
}

function isTextMime(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return mimeType.startsWith('text/') || isJsonMime(mimeType);
}

function isJsonMime(mimeType: string | undefined): boolean {
  return Boolean(mimeType && (mimeType === 'application/json' || mimeType.endsWith('+json')));
}

function normalizeText(text: string, mimeType: string | undefined): string {
  if (!isJsonMime(mimeType)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
