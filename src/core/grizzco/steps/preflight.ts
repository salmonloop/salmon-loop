import { text } from '../../../locales/index.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { resolveExecutionProfile } from '../../runtime/execution-profile.js';
import { createStandardToolstack } from '../../tools/loader.js';
import { preflight } from '../../verification/runner.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { InitCtx, PreflightCtx } from '../engine/pipeline/types.js';

export const runPreflight: Step<InitCtx, PreflightCtx> = async (ctx) => {
  const executionProfile = resolveExecutionProfile(ctx.mode);
  const result = await preflight(ctx.workspace, ctx.emit, {
    ignoreDirty: executionProfile.ignoreDirtyPreflight,
  });

  if (!result.ok) {
    const reason = result.reason || text.loop.preflightFailedNotGit;
    ctx.emit({
      type: 'log',
      level: 'error',
      message: reason,
      timestamp: new Date(),
    });
    const error = new Error(reason) as Error & { code?: string };
    error.code = result.reasonCode || 'LOOP_FAILED';
    throw error;
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.loop.preflightPassed,
    timestamp: new Date(),
  });

  const toolstack = resolveLlmToolCallingPolicy(executionProfile.entryPhase, ctx.options.llm).enabled
    ? await createStandardToolstack({
        repoRoot: ctx.workspace.workPath,
        persistenceRoot: ctx.workspace.baseRepoPath || ctx.workspace.workPath,
        worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
        attemptId: ctx.attempt ?? 1,
        dryRun: Boolean(ctx.options?.dryRun),
        allowedToolNames: Array.isArray(ctx.options.allowedToolNames)
          ? ctx.options.allowedToolNames
          : undefined,
        permissionRules: ctx.options.permissionRules,
        authorizationProvider: ctx.options.authorizationProvider,
        authorizationMode: ctx.options.authorizationMode,
        extensions: ctx.options.extensions,
        onAuthorizationSummary: (summary) => {
          ctx.emit({
            type: 'authorization.summary',
            summary,
            stage: 'realtime',
            timestamp: new Date(),
          });
        },
        onAuthorizationDecision: (event) => {
          if (!ctx.options.eventPayload?.includeAuthorizationDecisions) return;

          ctx.emit({
            type: 'authorization.decision',
            callId: event.callId,
            toolName: event.toolName,
            phase: event.phase,
            outcome: event.outcome,
            source: event.source,
            reason: event.reason,
            ttlMs: event.ttlMs,
            persist: event.persist,
            riskLevel: event.riskLevel,
            sideEffects: event.sideEffects,
            timestamp: new Date(),
          });

          recordAuditEvent(
            'authorization.decision',
            {
              callId: event.callId,
              toolName: event.toolName,
              phase: event.phase,
              outcome: event.outcome,
              source: event.source,
              reason: event.reason,
              ttlMs: event.ttlMs,
              persist: event.persist,
              riskLevel: event.riskLevel,
              sideEffects: event.sideEffects,
            },
            { source: 'tool', severity: 'low', scope: 'session', phase: event.phase },
          );
        },
        model:
          ctx.options.llm.getModelId?.() || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL,
      })
    : undefined;

  return {
    ...ctx,
    preflightResult: result,
    // Toolstack is created once per attempt when tool calling is enabled. This keeps governance
    // deterministic while avoiding unnecessary setup for non-tool-capable LLMs.
    toolstack,
    toolAuditLogger: toolstack?.audit,
  };
};
