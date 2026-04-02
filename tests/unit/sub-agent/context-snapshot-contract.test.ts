import { describe, expect, it } from 'bun:test';

import {
  cloneSubAgentContextSnapshot,
  mergeSubAgentContextSnapshot,
} from '../../../src/core/sub-agent/context-snapshot.js';

describe('sub-agent context snapshot contract', () => {
  it('assigns version=1 by default and preserves clone/share semantics', () => {
    const source = {
      conversationContext: [
        {
          role: 'assistant' as const,
          content: 'tool call',
          tool_calls: [{ id: 'call-1', function: { name: 'fs.read', arguments: '{}' } }],
        },
        {
          role: 'tool' as const,
          content: '{"ok":true}',
          tool_call_id: 'call-1',
        },
      ],
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-1',
          mimeType: 'text/plain',
          sha256: 'verify-1',
          size: 100,
        },
      },
      toolCallingAudit: [
        {
          timestamp: new Date().toISOString(),
          phase: 'PLAN' as const,
          round: 0,
          callId: 'call-1',
          toolName: 'fs.read',
          rawArgsType: 'string' as const,
          parsedArgsOk: true,
          toolResultStatus: 'ok' as const,
        },
      ],
      planRuntime: {
        sessionId: 'plan-1',
        planPathHint: '.salmonloop/plan.md',
      },
      cacheSharing: {
        namespace: 'plan',
        contextHash: 'ctx-1',
      },
    };

    const cloned = cloneSubAgentContextSnapshot(source as any);

    expect(cloned?.version).toBe(1);
    expect(cloned?.conversationContext).toEqual(source.conversationContext);
    expect(cloned?.artifactHints).toEqual(source.artifactHints);
    expect(cloned?.toolCallingAudit).toEqual(source.toolCallingAudit);
    expect(cloned?.planRuntime).toBe(source.planRuntime);
    expect(cloned?.cacheSharing).toBe(source.cacheSharing);
    expect(cloned?.conversationContext).not.toBe(source.conversationContext);
    expect(cloned?.artifactHints).not.toBe(source.artifactHints);
    expect(cloned?.toolCallingAudit).not.toBe(source.toolCallingAudit);
    expect(cloned?.conversationContext?.[0]?.tool_calls).toEqual(
      source.conversationContext[0].tool_calls,
    );
    expect(cloned?.conversationContext?.[0]?.tool_calls).not.toBe(
      source.conversationContext[0].tool_calls,
    );
  });

  it('fails closed on unsupported snapshot version', () => {
    expect(() =>
      cloneSubAgentContextSnapshot({
        version: 99,
        conversationContext: [{ role: 'user', content: 'x' }],
      } as any),
    ).toThrow('Unsupported sub-agent context snapshot version');
  });

  it('merges runtime snapshot over request snapshot and keeps version', () => {
    const merged = mergeSubAgentContextSnapshot(
      {
        version: 1,
        conversationContext: [{ role: 'user', content: 'from request' }],
        cacheSharing: { namespace: 'request', contextHash: 'request-hash' },
      } as any,
      {
        conversationContext: [{ role: 'assistant', content: 'from runtime' }],
        cacheSharing: { namespace: 'runtime', contextHash: 'runtime-hash' },
      } as any,
    );

    expect(merged?.version).toBe(1);
    expect(merged?.conversationContext).toEqual([{ role: 'assistant', content: 'from runtime' }]);
    expect(merged?.cacheSharing).toEqual({
      namespace: 'runtime',
      contextHash: 'runtime-hash',
    });
  });

  it('fails closed when runtime snapshot has unsupported version during merge', () => {
    expect(() =>
      mergeSubAgentContextSnapshot(
        {
          version: 1,
          conversationContext: [{ role: 'user', content: 'request' }],
        } as any,
        {
          version: 99,
          conversationContext: [{ role: 'assistant', content: 'runtime' }],
        } as any,
      ),
    ).toThrow('Unsupported sub-agent context snapshot version');
  });
});
