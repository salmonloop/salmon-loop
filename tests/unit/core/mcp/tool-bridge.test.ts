import { describe, expect, it, mock } from 'bun:test';

import {
  mcpClassifierResultToBridgeClassification,
  mcpToolDescriptorToToolSpec,
  wrapMcpToolResult,
  type McpLongConnectionManager,
  type McpPolicyGrant,
  type McpToolDescriptor,
} from '../../../../src/core/mcp/bridge/tool-bridge.js';
import { Phase } from '../../../../src/core/types/runtime.js';

function managerReturning(result: any): McpLongConnectionManager {
  return {
    callTool: mock(async () => result),
  };
}

function readDescriptor(overrides: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
  return {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
    ...overrides,
  };
}

function grant(overrides: Partial<McpPolicyGrant> = {}): McpPolicyGrant {
  return {
    allowedPhases: [Phase.CONTEXT, Phase.PLAN],
    grantedBy: 'repo-config',
    grantedAt: '2026-05-19T00:00:00.000Z',
    metadata: { ticket: 'MCP-v2' },
    ...overrides,
  };
}

describe('mcpToolDescriptorToToolSpec', () => {
  it('maps read-only MCP tools into CONTEXT and PLAN from the policy grant', () => {
    const spec = mcpToolDescriptorToToolSpec({
      serverName: 'local',
      descriptor: readDescriptor(),
      grant: grant({ allowedPhases: [Phase.CONTEXT, Phase.PLAN] }),
      classification: {
        kind: 'classified',
        sideEffects: ['fs_read'],
        riskLevel: 'low',
        reason: 'readOnlyHint',
      },
      manager: managerReturning({ content: [] }),
    });

    expect(spec.name).toBe('mcp.local.read_file');
    expect(spec.source).toBe('mcp');
    expect(spec.intent).toBe('READ');
    expect(spec.riskLevel).toBe('low');
    expect(spec.sideEffects).toEqual(['fs_read']);
    expect(spec.concurrency).toBe('parallel_ok');
    expect(spec.allowedPhases).toEqual([Phase.CONTEXT, Phase.PLAN]);
    expect(spec.inputSchema.parse({ path: 'README.md' })).toEqual({ path: 'README.md' });
    expect(() => spec.inputSchema.parse({})).toThrow();
  });

  it('keeps output schema, structuredContent, and resource links in the bridge wrapper', async () => {
    const result = {
      content: [
        { type: 'text', text: 'ok' },
        {
          type: 'resource_link',
          uri: 'file:///tmp/report.json',
          name: 'report',
          mimeType: 'application/json',
        },
      ],
      structuredContent: { content: 'hello' },
      _meta: { traceId: 'abc' },
    };
    const manager = managerReturning(result);
    const spec = mcpToolDescriptorToToolSpec({
      serverName: 'local',
      descriptor: readDescriptor(),
      grant: grant(),
      classification: { kind: 'classified', sideEffects: ['fs_read'], riskLevel: 'low' },
      manager,
    });

    const output = await spec.executor({ path: 'README.md' }, { signal: undefined } as any);

    expect(manager.callTool).toHaveBeenCalledWith(
      'local',
      'read_file',
      { path: 'README.md' },
      {
        signal: undefined,
      },
    );
    expect(output.structuredContent).toEqual({ content: 'hello' });
    expect(output.resourceLinks).toEqual([
      {
        type: 'resource_link',
        uri: 'file:///tmp/report.json',
        name: 'report',
        mimeType: 'application/json',
      },
    ]);
    expect(spec.outputSchema.parse(output)).toEqual(output);
    expect(() =>
      spec.outputSchema.parse({ ...output, structuredContent: { content: 123 } }),
    ).toThrow();
  });

  it('accepts non-object structuredContent values allowed by MCP outputSchema', async () => {
    const arrayResult = {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: [{ hour: '09:00', temp: 21 }],
    };
    const arraySpec = mcpToolDescriptorToToolSpec({
      serverName: 'local',
      descriptor: readDescriptor({
        outputSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              hour: { type: 'string' },
              temp: { type: 'number' },
            },
            required: ['hour', 'temp'],
            additionalProperties: false,
          },
        },
      }),
      grant: grant(),
      classification: { kind: 'classified', sideEffects: ['fs_read'], riskLevel: 'low' },
      manager: managerReturning(arrayResult),
    });

    const arrayOutput = await arraySpec.executor({ path: 'README.md' }, {
      signal: undefined,
    } as any);
    expect(arrayOutput.structuredContent).toEqual([{ hour: '09:00', temp: 21 }]);
    expect(arraySpec.outputSchema.parse(arrayOutput)).toEqual(arrayOutput);

    const numberResult = {
      content: [],
      structuredContent: 42,
    };
    const numberSpec = mcpToolDescriptorToToolSpec({
      serverName: 'local',
      descriptor: readDescriptor({
        outputSchema: {
          type: 'number',
        },
      }),
      grant: grant(),
      classification: { kind: 'classified', sideEffects: ['fs_read'], riskLevel: 'low' },
      manager: managerReturning(numberResult),
    });

    const numberOutput = await numberSpec.executor({ path: 'README.md' }, {
      signal: undefined,
    } as any);
    expect(numberOutput.structuredContent).toBe(42);
    expect(numberSpec.outputSchema.parse(numberOutput)).toEqual(numberOutput);
  });

  it('adds grant metadata to authorization summaries for write tools', async () => {
    const spec = mcpToolDescriptorToToolSpec({
      serverName: 'repo',
      descriptor: readDescriptor({
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      }),
      grant: grant({
        allowedPhases: [Phase.AUTOPILOT],
        grantedBy: 'security-admin',
        metadata: { approvalId: 'AUTH-42', scope: 'workspace' },
      }),
      classification: {
        kind: 'classified',
        sideEffects: ['fs_write'],
        riskLevel: 'high',
        reason: 'destructiveHint',
      },
      manager: managerReturning({ content: [] }),
    });

    const summary = await spec.summarizeArgsForAuthorization?.(
      { path: 'src/index.ts', content: 'updated' },
      {} as any,
    );

    expect(spec.sideEffects).toEqual(['fs_write']);
    expect(spec.riskLevel).toBe('high');
    expect(spec.allowedPhases).toEqual([Phase.AUTOPILOT]);
    expect(summary).toContain('security-admin');
    expect(summary).toContain('AUTH-42');
    expect(summary).toContain('workspace');
    expect(summary).toContain('src/index.ts');
  });

  it('falls back to high-risk process/network when the classifier cannot prove effects', () => {
    const spec = mcpToolDescriptorToToolSpec({
      serverName: 'remote',
      descriptor: readDescriptor({ name: 'unknown_tool' }),
      grant: grant({ allowedPhases: [Phase.VERIFY] }),
      classification: {
        kind: 'fallback',
        reason: 'classifier unavailable',
      },
      manager: managerReturning({ content: [] }),
    });

    expect(spec.riskLevel).toBe('high');
    expect(spec.sideEffects).toEqual(['process', 'network']);
    expect(spec.concurrency).toBe('serial_only');
    expect(spec.allowedPhases).toEqual([Phase.VERIFY]);
  });

  it('accepts the MCP policy classifier result without blanket process/network effects', () => {
    const classification = mcpClassifierResultToBridgeClassification({
      risk: 'medium',
      facets: { read: true, write: false, network: true, process: false },
      reasons: ['name implies read access', 'annotation marks tool open-world'],
    });
    const spec = mcpToolDescriptorToToolSpec({
      serverName: 'remote',
      descriptor: readDescriptor({ name: 'fetch_status' }),
      grant: grant({ allowedPhases: [Phase.PLAN] }),
      classification,
      manager: managerReturning({ content: [] }),
    });

    expect(spec.sideEffects).toEqual(['fs_read', 'network']);
    expect(spec.riskLevel).toBe('medium');
    expect(spec.intent).toBe('READ');
    expect(spec.sideEffects).not.toContain('process');
  });
});

describe('wrapMcpToolResult', () => {
  it('normalizes missing content and preserves raw MCP result fields', () => {
    const wrapped = wrapMcpToolResult({
      structuredContent: { ok: true },
      isError: false,
      custom: 'value',
    });

    expect(wrapped.content).toEqual([]);
    expect(wrapped.resourceLinks).toEqual([]);
    expect(wrapped.structuredContent).toEqual({ ok: true });
    expect(wrapped.raw).toEqual({
      structuredContent: { ok: true },
      isError: false,
      custom: 'value',
      content: [],
    });
  });

  it('preserves non-object structuredContent values', () => {
    const arrayWrapped = wrapMcpToolResult({
      structuredContent: [{ ok: true }],
    });
    const numberWrapped = wrapMcpToolResult({
      structuredContent: 42,
    });

    expect(arrayWrapped.structuredContent).toEqual([{ ok: true }]);
    expect(arrayWrapped.raw.structuredContent).toEqual([{ ok: true }]);
    expect(numberWrapped.structuredContent).toBe(42);
    expect(numberWrapped.raw.structuredContent).toBe(42);
  });
});
