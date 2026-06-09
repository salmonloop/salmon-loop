import { beforeEach, describe, expect, it } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';
import { normalizeDispatchRequest } from '../../../src/core/sub-agent/tools/task-spawn.js';
import type { SubAgentRequest } from '../../../src/core/sub-agent/types.js';
import { createMockToolRuntimeCtx } from '../../helpers/sub-agent-fixtures.js';

function makeRequest(overrides?: Partial<SubAgentRequest>): SubAgentRequest {
  return {
    agent_ref: 'explorer',
    task: 'inspect code',
    ...overrides,
  };
}

describe('normalizeDispatchRequest', () => {
  beforeEach(() => {
    clearAuditTrail();
  });

  describe('default session_target', () => {
    it('defaults to isolated when session_target is omitted', () => {
      const result = normalizeDispatchRequest(makeRequest(), createMockToolRuntimeCtx());
      expect(result.session_target).toBe('isolated');
    });

    it('preserves explicit isolated', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ session_target: 'isolated' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.session_target).toBe('isolated');
    });

    it('preserves explicit shared', () => {
      const ctx = createMockToolRuntimeCtx({
        contextSnapshot: {
          cacheSharing: {
            contextHash: 'ctx',
            toolSchemaHash: 'tool',
            systemPrefixDigest: 'prefix',
          },
        },
      });
      const result = normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
        ctx,
      );
      expect(result.session_target).toBe('shared');
    });
  });

  describe('default expected_output', () => {
    it('defaults to diagnosis for explorer', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ agent_ref: 'explorer' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.expected_output).toBe('diagnosis');
    });

    it('defaults to patch for surgeon', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ agent_ref: 'surgeon' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.expected_output).toBe('patch');
    });

    it('defaults to patch for cleaner', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ agent_ref: 'cleaner' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.expected_output).toBe('patch');
    });

    it('defaults to review for reviewer', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ agent_ref: 'reviewer' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.expected_output).toBe('review');
    });

    it('defaults to diagnosis for unknown agent_ref', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ agent_ref: 'custom-agent' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.expected_output).toBe('diagnosis');
    });

    it('preserves explicit expected_output', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ agent_ref: 'surgeon', expected_output: 'diagnosis' }),
        createMockToolRuntimeCtx(),
      );
      expect(result.expected_output).toBe('diagnosis');
    });
  });

  describe('shared-to-isolated fallback', () => {
    it('falls back when request has no cacheSharing', () => {
      const result = normalizeDispatchRequest(
        makeRequest({ session_target: 'shared' }),
        createMockToolRuntimeCtx({
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
      );
      expect(result.session_target).toBe('isolated');
      expect(result.contextSnapshot).toBeUndefined();
    });

    it('falls back when runtime has no cacheSharing', () => {
      const result = normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
        createMockToolRuntimeCtx(),
      );
      expect(result.session_target).toBe('isolated');
      expect(result.contextSnapshot).toBeUndefined();
    });

    it('falls back when contextHash mismatches', () => {
      const result = normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx-request',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
        createMockToolRuntimeCtx({
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx-runtime',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
      );
      expect(result.session_target).toBe('isolated');
      expect(result.contextSnapshot).toBeUndefined();
    });

    it('falls back when toolSchemaHash mismatches', () => {
      const result = normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool-request',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
        createMockToolRuntimeCtx({
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool-runtime',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
      );
      expect(result.session_target).toBe('isolated');
    });

    it('falls back when systemPrefixDigest mismatches', () => {
      const result = normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix-request',
            },
          },
        }),
        createMockToolRuntimeCtx({
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix-runtime',
            },
          },
        }),
      );
      expect(result.session_target).toBe('isolated');
    });

    it('records audit event on fallback', () => {
      normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx-request',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
        createMockToolRuntimeCtx({
          phase: 'PLAN',
          contextSnapshot: {
            cacheSharing: {
              contextHash: 'ctx-runtime',
              toolSchemaHash: 'tool',
              systemPrefixDigest: 'prefix',
            },
          },
        }),
      );

      const event = getAuditTrail().find(
        (e) => e.action === 'sub_agent.shared.prefix_consistency_failed',
      );
      expect(event).toBeDefined();
      expect(event!.details).toMatchObject({
        metric: 'shared_fallback_rate',
        fallbackMode: 'isolated',
        reason: 'cache_critical_prefix_mismatch',
      });
      expect(event!.phase).toBe('PLAN');
    });
  });

  describe('shared session with compatible digests', () => {
    const compatibleSharing = {
      cacheSharing: {
        contextHash: 'ctx',
        toolSchemaHash: 'tool',
        systemPrefixDigest: 'prefix',
      },
    };

    it('merges contextSnapshot from runtime', () => {
      const runtimeSnapshot = {
        ...compatibleSharing,
        conversationContext: [{ role: 'assistant' as const, content: 'from runtime' }],
        planRuntime: { sessionId: 'plan-1', planPathHint: '.plan.md' },
      };

      const result = normalizeDispatchRequest(
        makeRequest({
          session_target: 'shared',
          contextSnapshot: {
            ...compatibleSharing,
            conversationContext: [{ role: 'user' as const, content: 'from request' }],
          },
        }),
        createMockToolRuntimeCtx({ contextSnapshot: runtimeSnapshot }),
      );

      expect(result.session_target).toBe('shared');
      // Runtime conversationContext takes precedence
      expect(result.contextSnapshot?.conversationContext).toEqual([
        { role: 'assistant', content: 'from runtime' },
      ]);
    });

    it('clone semantics: mutable fields are not shared by reference', () => {
      const runtimeConversation = [{ role: 'assistant' as const, content: 'shared' }];
      const runtimeAudit = [
        {
          timestamp: 't',
          phase: 'PLAN',
          round: 0,
          callId: 'c',
          toolName: 'x',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        },
      ];

      const result = normalizeDispatchRequest(
        makeRequest({ session_target: 'shared', contextSnapshot: { ...compatibleSharing } }),
        createMockToolRuntimeCtx({
          contextSnapshot: {
            ...compatibleSharing,
            conversationContext: runtimeConversation,
            toolCallingAudit: runtimeAudit,
          },
        }),
      );

      expect(result.contextSnapshot?.conversationContext).not.toBe(runtimeConversation);
      expect(result.contextSnapshot?.toolCallingAudit).not.toBe(runtimeAudit);
    });

    it('share semantics: planRuntime and cacheSharing are shared by reference', () => {
      const planRuntime = { sessionId: 'p1', planPathHint: '.plan.md' };
      const cacheSharing = { ...compatibleSharing.cacheSharing };

      const result = normalizeDispatchRequest(
        makeRequest({ session_target: 'shared', contextSnapshot: { ...compatibleSharing } }),
        createMockToolRuntimeCtx({
          contextSnapshot: { ...compatibleSharing, planRuntime, cacheSharing },
        }),
      );

      expect(result.contextSnapshot?.planRuntime).toBe(planRuntime);
      expect(result.contextSnapshot?.cacheSharing).toBe(cacheSharing);
    });
  });

  describe('input immutability', () => {
    it('does not mutate the input request', () => {
      const input = makeRequest({ agent_ref: 'surgeon' });
      const original = { ...input };
      normalizeDispatchRequest(input, createMockToolRuntimeCtx());
      expect(input).toEqual(original);
    });
  });
});
