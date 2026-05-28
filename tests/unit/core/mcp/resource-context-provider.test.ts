import { describe, expect, it } from 'bun:test';

import {
  McpResourceContextProvider,
  ResourceContextProvider,
} from '../../../../src/core/mcp/bridge/resource-context-provider.js';
import type {
  McpResourceConnection,
  McpResourceMetadata,
  ResourcePolicyCheckInput,
} from '../../../../src/core/mcp/bridge/resource-context-provider.js';
import { ResourceCache } from '../../../../src/core/mcp/cache/resource-cache.js';

function connection(contentsByUri: Record<string, any>, reads: string[]): McpResourceConnection {
  return {
    async readResource({ uri }) {
      reads.push(uri);
      const value = contentsByUri[uri];
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function catalog(resources: McpResourceMetadata[]) {
  return {
    listResources() {
      return resources;
    },
  };
}

describe('ResourceContextProvider', () => {
  it('includes required and autoInclude resources by default, but leaves manual resources explicit', async () => {
    const reads: string[] = [];
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/required',
          name: 'Required',
          includeIntent: 'required',
          mimeType: 'text/plain',
        },
        {
          serverName: 'docs',
          uri: 'mcp://docs/manual',
          name: 'Manual',
          includeIntent: 'manual',
          mimeType: 'text/plain',
        },
        {
          serverName: 'docs',
          uri: 'mcp://docs/auto',
          name: 'Auto',
          includeIntent: 'autoInclude',
          mimeType: 'application/json',
        },
      ]),
      connections: {
        docs: connection(
          {
            'mcp://docs/required': {
              contents: [{ uri: 'mcp://docs/required', text: 'required text' }],
            },
            'mcp://docs/manual': {
              contents: [{ uri: 'mcp://docs/manual', text: 'manual text' }],
            },
            'mcp://docs/auto': {
              contents: [
                { uri: 'mcp://docs/auto', text: '{"ok":true}', mimeType: 'application/json' },
              ],
            },
          },
          reads,
        ),
      },
      policy: { checkUri: () => true },
    });

    const first = await provider.provide();

    expect(first.blocks.map((block) => block.uri)).toEqual([
      'mcp://docs/required',
      'mcp://docs/auto',
    ]);
    expect(first.blocks[1]?.type).toBe('resource_text');
    if (first.blocks[1]?.type === 'resource_text') {
      expect(first.blocks[1].content.format).toBe('json');
      expect(first.blocks[1].content.text).toContain('"ok": true');
    }
    expect(reads).toEqual(['mcp://docs/required', 'mcp://docs/auto']);

    const second = await provider.provide({
      resources: [{ serverName: 'docs', uri: 'mcp://docs/manual', intent: 'manual' }],
    });

    expect(second.blocks.map((block) => block.uri)).toEqual([
      'mcp://docs/required',
      'mcp://docs/auto',
      'mcp://docs/manual',
    ]);
  });

  it('checks policy before read and reports optional denied resources as diagnostics', async () => {
    const reads: string[] = [];
    const checks: ResourcePolicyCheckInput[] = [];
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/manual',
          includeIntent: 'manual',
          mimeType: 'text/plain',
        },
      ]),
      connections: {
        docs: connection(
          {
            'mcp://docs/manual': {
              contents: [{ uri: 'mcp://docs/manual', text: 'manual text' }],
            },
          },
          reads,
        ),
      },
      policy: {
        checkUri(input) {
          checks.push(input);
          return { allowed: false, reason: 'denied by test' };
        },
      },
    });

    const result = await provider.provide({
      resources: [{ serverName: 'docs', uri: 'mcp://docs/manual', intent: 'manual' }],
    });

    expect(checks).toHaveLength(1);
    expect(reads).toEqual([]);
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'POLICY_DENIED',
        message: 'denied by test',
        uri: 'mcp://docs/manual',
        optional: true,
      }),
    ]);
  });

  it('throws when a required resource read fails', async () => {
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/required',
          includeIntent: 'required',
          mimeType: 'text/plain',
        },
      ]),
      connections: {
        docs: connection({ 'mcp://docs/required': new Error('read boom') }, []),
      },
      policy: { checkUri: () => true },
    });

    await expect(provider.provide()).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'READ_FAILED',
        optional: false,
        uri: 'mcp://docs/required',
      }),
    });
  });

  it('emits resource link metadata for blob content instead of prompt text', async () => {
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'images',
          uri: 'mcp://images/logo',
          name: 'Logo',
          includeIntent: 'autoInclude',
          mimeType: 'image/png',
          size: 2048,
        },
      ]),
      connections: {
        images: connection(
          {
            'mcp://images/logo': {
              contents: [{ uri: 'mcp://images/logo', blob: 'iVBORw0KGgo=', mimeType: 'image/png' }],
            },
          },
          [],
        ),
      },
      policy: { checkUri: () => true },
    });

    const result = await provider.provide();

    expect(result.blocks).toEqual([
      expect.objectContaining({
        type: 'resource_link',
        uri: 'mcp://images/logo',
        reason: 'blob',
        metadata: expect.objectContaining({
          name: 'Logo',
          mimeType: 'image/png',
          size: 2048,
        }),
      }),
    ]);
    expect(JSON.stringify(result.blocks)).not.toContain('iVBORw0KGgo=');
  });

  it('uses TTL cache and refreshes expired entries', async () => {
    let now = 0;
    const reads: string[] = [];
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/cached',
          includeIntent: 'autoInclude',
          mimeType: 'text/plain',
        },
      ]),
      connections: {
        docs: connection(
          {
            'mcp://docs/cached': {
              contents: [{ uri: 'mcp://docs/cached', text: 'cached text' }],
            },
          },
          reads,
        ),
      },
      policy: { checkUri: () => true },
      cache: new ResourceCache({ ttlMs: 10, now: () => now }),
    });

    const first = await provider.provide();
    const second = await provider.provide();
    now = 11;
    const third = await provider.provide();

    expect(reads).toEqual(['mcp://docs/cached', 'mcp://docs/cached']);
    expect(first.meta.cacheMisses).toBe(1);
    expect(second.meta.cacheHits).toBe(1);
    expect(third.meta.cacheMisses).toBe(1);
  });

  it('caches every content block returned by a multi-part MCP resource read', async () => {
    const reads: string[] = [];
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/multipart',
          includeIntent: 'autoInclude',
          mimeType: 'text/plain',
        },
      ]),
      connections: {
        docs: connection(
          {
            'mcp://docs/multipart': {
              contents: [
                { uri: 'mcp://docs/multipart', text: 'first part', mimeType: 'text/plain' },
                { uri: 'mcp://docs/multipart#2', text: 'second part', mimeType: 'text/plain' },
              ],
            },
          },
          reads,
        ),
      },
      policy: { checkUri: () => true },
    });

    const first = await provider.provide();
    const second = await provider.provide();

    expect(first.blocks).toHaveLength(2);
    expect(first.blocks[0]).toEqual(
      expect.objectContaining({
        type: 'resource_text',
        uri: 'mcp://docs/multipart',
        content: expect.objectContaining({ text: 'first part' }),
      }),
    );
    expect(first.blocks[1]).toEqual(
      expect.objectContaining({
        type: 'resource_text',
        uri: 'mcp://docs/multipart#2',
        content: expect.objectContaining({ text: 'second part' }),
      }),
    );
    expect(second.blocks).toEqual(first.blocks);
    expect(reads).toEqual(['mcp://docs/multipart']);
    expect(second.meta.cacheHits).toBe(1);
  });

  it('preserves per-content URIs returned by MCP resource reads', async () => {
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/multipart',
          includeIntent: 'autoInclude',
          mimeType: 'text/plain',
        },
      ]),
      connections: {
        docs: connection(
          {
            'mcp://docs/multipart': {
              contents: [
                { uri: 'mcp://docs/multipart', text: 'first part', mimeType: 'text/plain' },
                { uri: 'mcp://docs/multipart#2', text: 'second part', mimeType: 'text/plain' },
              ],
            },
          },
          [],
        ),
      },
      policy: { checkUri: () => true },
    });

    const result = await provider.provide();

    expect(result.blocks[0]).toEqual(
      expect.objectContaining({
        type: 'resource_text',
        uri: 'mcp://docs/multipart',
      }),
    );
    expect(result.blocks[1]).toEqual(
      expect.objectContaining({
        type: 'resource_text',
        uri: 'mcp://docs/multipart#2',
      }),
    );
  });

  it('truncates text by budget and emits links once budget is exhausted', async () => {
    const provider = new ResourceContextProvider({
      catalog: catalog([
        {
          serverName: 'docs',
          uri: 'mcp://docs/a',
          includeIntent: 'required',
          mimeType: 'text/plain',
        },
        {
          serverName: 'docs',
          uri: 'mcp://docs/b',
          includeIntent: 'autoInclude',
          mimeType: 'text/plain',
        },
      ]),
      connections: {
        docs: connection(
          {
            'mcp://docs/a': {
              contents: [{ uri: 'mcp://docs/a', text: 'abcdef' }],
            },
            'mcp://docs/b': {
              contents: [{ uri: 'mcp://docs/b', text: 'second' }],
            },
          },
          [],
        ),
      },
      policy: { checkUri: () => true },
      options: { budgetChars: 4, maxResourceChars: 100 },
    });

    const result = await provider.provide();

    expect(result.meta.usedChars).toBe(4);
    expect(result.meta.truncated).toBe(true);
    expect(result.blocks[0]).toEqual(
      expect.objectContaining({
        type: 'resource_text',
        includedChars: 4,
        truncated: true,
      }),
    );
    expect(result.blocks[1]).toEqual(
      expect.objectContaining({
        type: 'resource_link',
        reason: 'budget_exhausted',
        uri: 'mcp://docs/b',
      }),
    );
  });

  it('invalidates cached reads when the manager reports a resource update', async () => {
    const reads: string[] = [];
    let onResourceUpdated:
      | ((event: { serverName: string; uri: string }) => void | Promise<void>)
      | undefined;
    const provider = new McpResourceContextProvider(
      {
        listCatalogs: () => [
          {
            serverName: 'docs',
            resources: [{ uri: 'mcp://docs/cached', mimeType: 'text/plain' }],
          },
        ],
        readResource: async (_serverName: string, uri: string) => {
          reads.push(uri);
          return { contents: [{ uri, text: 'cached text', mimeType: 'text/plain' }] };
        },
        onResourceUpdated: (handler: (event: { serverName: string; uri: string }) => void) => {
          onResourceUpdated = handler;
          return () => {};
        },
      } as any,
      {
        decideResource: () => ({ allowed: true }),
      } as any,
    );

    await provider.read({
      server: 'docs',
      uri: 'mcp://docs/cached',
      intent: 'manual',
      maxBytes: 1024,
      ttlMs: 30_000,
    });
    await provider.read({
      server: 'docs',
      uri: 'mcp://docs/cached',
      intent: 'manual',
      maxBytes: 1024,
      ttlMs: 30_000,
    });
    await onResourceUpdated?.({ serverName: 'docs', uri: 'mcp://docs/cached' });
    await provider.read({
      server: 'docs',
      uri: 'mcp://docs/cached',
      intent: 'manual',
      maxBytes: 1024,
      ttlMs: 30_000,
    });

    expect(reads).toEqual(['mcp://docs/cached', 'mcp://docs/cached']);
  });

  it('invalidates cached parent resource reads when the update targets a sub-resource', async () => {
    const reads: string[] = [];
    let onResourceUpdated:
      | ((event: { serverName: string; uri: string }) => void | Promise<void>)
      | undefined;
    const provider = new McpResourceContextProvider(
      {
        listCatalogs: () => [
          {
            serverName: 'docs',
            resources: [{ uri: 'mcp://docs/folder', mimeType: 'text/plain' }],
          },
        ],
        readResource: async (_serverName: string, uri: string) => {
          reads.push(uri);
          return { contents: [{ uri, text: 'folder summary', mimeType: 'text/plain' }] };
        },
        onResourceUpdated: (handler: (event: { serverName: string; uri: string }) => void) => {
          onResourceUpdated = handler;
          return () => {};
        },
      } as any,
      {
        decideResource: () => ({ allowed: true }),
      } as any,
    );

    await provider.read({
      server: 'docs',
      uri: 'mcp://docs/folder',
      intent: 'manual',
      maxBytes: 1024,
      ttlMs: 30_000,
    });
    await provider.read({
      server: 'docs',
      uri: 'mcp://docs/folder',
      intent: 'manual',
      maxBytes: 1024,
      ttlMs: 30_000,
    });
    await onResourceUpdated?.({ serverName: 'docs', uri: 'mcp://docs/folder/child.txt' });
    await provider.read({
      server: 'docs',
      uri: 'mcp://docs/folder',
      intent: 'manual',
      maxBytes: 1024,
      ttlMs: 30_000,
    });

    expect(reads).toEqual(['mcp://docs/folder', 'mcp://docs/folder']);
  });
});
