import { text } from '../../../locales/index.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { writeDebugArtifact } from '../../observability/debug-artifacts.js';
import { buildErrorEnvelope, toSafeErrorSummary } from '../../observability/error-envelope.js';
import { WorkspaceSynchronizer } from '../../strata/runtime/synchronizer.js';
import type { ApplyBackTelemetry } from '../../strata/runtime/synchronizer.js';
import type { CheckpointRef, LoopEvent, LoopOptions } from '../../types/index.js';

import { collectSidecarPaths } from './apply-back-utils.js';

export interface ApplyBackPhaseParams {
  attempt: number;
  options: LoopOptions;
  checkpointRef?: CheckpointRef;
  initialSnapshotHash?: string;
  synchronizer: WorkspaceSynchronizer;
  activeRepoPath: string;
  shadowTaskId: string;
  emit?: (event: LoopEvent) => void;
  diff?: string;
  changedFiles: string[];
}

export interface ApplyBackPhaseResult {
  success: boolean;
  skipped: boolean;
  telemetry: ApplyBackTelemetry;
  error?: string;
  errorCode?: string;
  safeMessage?: string;
  safeMeta?: Record<string, unknown>;
  debugArtifact?: { path: string; sha256: string; chars: number };
}

export async function runApplyBackPhase(
  params: ApplyBackPhaseParams,
): Promise<ApplyBackPhaseResult> {
  const {
    checkpointRef,
    initialSnapshotHash,
    options,
    synchronizer,
    activeRepoPath,
    shadowTaskId,
    attempt,
    emit,
  } = params;
  const applyBackTelemetry: ApplyBackTelemetry = {};
  const nowIso = () => new Date().toISOString();
  type ApplyBackFailureStage = 'checkpointCommit' | 'applyBackToMain' | 'unknown';
  let failureStage: ApplyBackFailureStage = 'unknown';

  const toSafeTelemetry = (telemetry: ApplyBackTelemetry): Record<string, unknown> => ({
    startedAt: telemetry.startedAt,
    finishedAt: telemetry.finishedAt,
    policy: telemetry.policy,
    usedShadowRefs: telemetry.usedShadowRefs,
    selectedStrategy: telemetry.selectedStrategy,
    dirtyAtEntry: telemetry.dirtyAtEntry,
    dirtyBackupCreated: telemetry.dirtyBackupCreated,
    didBeginApply: telemetry.didBeginApply,
    appliedToMain: telemetry.appliedToMain,
    workspaceChangedAfterFailure: telemetry.workspaceChangedAfterFailure,
    rollbackPath: telemetry.rollbackPath,
    stagedRestoreAttempted: telemetry.stagedRestoreAttempted,
    stagedRestoreSucceeded: telemetry.stagedRestoreSucceeded,
  });

  if (!checkpointRef || options.strategy !== 'worktree') {
    recordAuditEvent(
      'apply_back.skipped',
      { attempt, strategy: options.strategy ?? 'direct' },
      { phase: 'APPLY_BACK', severity: 'low', scope: 'session' },
    );
    return { success: true, skipped: true, telemetry: applyBackTelemetry };
  }

  recordAuditEvent(
    'apply_back.start',
    {
      attempt,
      strategy: options.strategy ?? 'worktree',
      changedFiles: params.changedFiles.length,
    },
    { phase: 'APPLY_BACK', severity: 'low', scope: 'session' },
  );

  emit?.({
    type: 'log',
    level: 'info',
    message: text.loop.applyBackStarted(attempt),
    timestamp: new Date(),
  });

  try {
    failureStage = 'checkpointCommit';
    const finalRef =
      (await synchronizer.createCheckpointCommit(
        activeRepoPath,
        shadowTaskId,
        `final-${attempt}`,
      )) || checkpointRef.baseRef;

    failureStage = 'applyBackToMain';
    await synchronizer.applyBackToMainWorkspace(
      options.repoPath,
      checkpointRef,
      params.diff || '',
      options.applyBackOnDirty ?? '3way',
      options.verbose,
      params.changedFiles,
      initialSnapshotHash,
      finalRef,
      collectSidecarPaths(options),
      applyBackTelemetry,
    );

    recordAuditEvent(
      'apply_back.success',
      {
        attempt,
        changedFiles: params.changedFiles.length,
        telemetry: applyBackTelemetry,
      },
      { phase: 'APPLY_BACK', severity: 'low', scope: 'session' },
    );

    emit?.({
      type: 'log',
      level: 'info',
      message: text.loop.applyBackSucceeded(attempt),
      timestamp: new Date(),
    });

    return { success: true, skipped: false, telemetry: applyBackTelemetry };
  } catch (error) {
    const errorCode = 'APPLY_BACK_FAILED';
    const safeMeta: Record<string, unknown> = {
      stage: failureStage,
      attempt,
      changedFiles: params.changedFiles.length,
      strategy: options.strategy ?? 'direct',
      applyBackOnDirty: options.applyBackOnDirty ?? '3way',
      errorSummary: toSafeErrorSummary(error),
      timestamp: nowIso(),
    };

    const safeMessage =
      failureStage === 'checkpointCommit'
        ? text.loop.applyBackFailedPrepare
        : failureStage === 'applyBackToMain'
          ? text.loop.applyBackFailedSync
          : text.loop.applyBackFailed;

    let debugArtifact: { path: string; sha256: string; chars: number } | null = null;
    try {
      debugArtifact = await writeDebugArtifact({
        repoRoot: options.repoPath,
        prefix: 'apply-back-error',
        content: [
          `applyBack failure`,
          `attempt=${attempt}`,
          `stage=${failureStage}`,
          `changedFiles=${params.changedFiles.length}`,
          `strategy=${options.strategy ?? 'direct'}`,
          `applyBackOnDirty=${options.applyBackOnDirty ?? '3way'}`,
          '',
          `safeTelemetry=${JSON.stringify(toSafeTelemetry(applyBackTelemetry), null, 2)}`,
          '',
          `errorType=${error instanceof Error ? error.name : typeof error}`,
          `errorCode=${(error as any)?.code ?? (error as any)?.llmCode ?? ''}`,
          `errorMessage=${error instanceof Error ? error.message : String(error)}`,
        ].join('\n'),
      });
    } catch {
      // Best-effort: do not mask the primary failure if artifact writing fails.
    }

    const envelope = buildErrorEnvelope({
      domain: 'applyBack',
      code: errorCode,
      phase: 'APPLY_BACK',
      safeMessage,
      safeMeta,
      debugArtifact: debugArtifact ?? undefined,
    });

    recordAuditEvent(
      'apply_back.failure',
      {
        attempt,
        changedFiles: params.changedFiles.length,
        telemetry: toSafeTelemetry(applyBackTelemetry),
        errorCode,
        safeMessage,
        safeMeta,
        debugArtifact: debugArtifact ?? undefined,
      },
      { phase: 'APPLY_BACK', severity: 'high', scope: 'session' },
    );
    emit?.({
      type: 'log',
      level: 'error',
      message: envelope.safeMessage,
      code: envelope.code,
      timestamp: new Date(),
    });

    return {
      success: false,
      skipped: false,
      telemetry: applyBackTelemetry,
      error: envelope.safeMessage,
      errorCode: envelope.code,
      safeMessage: envelope.safeMessage,
      safeMeta: envelope.safeMeta,
      debugArtifact: envelope.debugArtifact,
    };
  }
}
