import { describe, expect, it } from 'bun:test';

import { ResourceContextProvider } from '../../../../src/core/mcp/bridge/resource-context-provider.js';
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
});
