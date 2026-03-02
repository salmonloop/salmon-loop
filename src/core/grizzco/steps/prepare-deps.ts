import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import {
  detectNodeRuntimeProfile,
  resolveNodeWorktreePrepareCommand,
} from '../../target-runtime/index.js';
import { runCommand } from '../../verification/runner.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { PreflightCtx, PrepareDepsCtx } from '../engine/pipeline/types.js';

export const runPrepareDeps: Step<PreflightCtx, PrepareDepsCtx> = async (ctx) => {
  if (ctx.workspace.strategy !== 'worktree') {
    recordAuditEvent(
      'prepare_deps.skipped',
      { reason: 'non_worktree', strategy: ctx.workspace.strategy },
      { source: 'verification', severity: 'low', scope: 'session', phase: 'PREPARE_DEPS' },
    );
    return ctx;
  }

  let command = ctx.options.worktreePrepare?.trim();
  if (!command) {
    const runtimeProfile = await detectNodeRuntimeProfile(ctx.workspace.workPath);
    if (runtimeProfile) {
      command = resolveNodeWorktreePrepareCommand(runtimeProfile);
      recordAuditEvent(
        'prepare_deps.auto_detected',
        { command, packageManager: runtimeProfile.packageManager, source: runtimeProfile.source },
        { source: 'verification', severity: 'low', scope: 'session', phase: 'PREPARE_DEPS' },
      );
    }
  }
  if (!command) {
    recordAuditEvent(
      'prepare_deps.skipped',
      { reason: 'no_command' },
      { source: 'verification', severity: 'low', scope: 'session', phase: 'PREPARE_DEPS' },
    );
    return ctx;
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: text.loop.worktreePrepareDebug(command),
    timestamp: new Date(),
  });
  recordAuditEvent(
    'prepare_deps.start',
    { command },
    { source: 'verification', severity: 'low', scope: 'session', phase: 'PREPARE_DEPS' },
  );

  const prepareResult = await runCommand(
    ctx.workspace.workPath,
    command,
    LIMITS.worktreePrepareTimeoutMs,
    undefined,
    ctx.options.signal,
  );

  recordAuditEvent(
    'prepare_deps.summary',
    {
      ok: prepareResult.ok,
      exitCode: prepareResult.exitCode,
      outputChars: prepareResult.output.length,
    },
    {
      source: 'verification',
      severity: prepareResult.ok ? 'low' : 'medium',
      scope: 'session',
      phase: 'PREPARE_DEPS',
    },
  );

  if (!prepareResult.ok) {
    const message = text.loop.worktreePrepareFailed(prepareResult.output);
    const error = new Error(message) as Error & { code?: string };
    error.code = 'DEPENDENCY_ERROR';
    throw error;
  }

  return ctx;
};
