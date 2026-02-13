import { sanitizeError } from '../../llm/errors.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
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
    message: `Apply-back started for attempt ${attempt}`,
    timestamp: new Date(),
  });

  try {
    const finalRef =
      (await synchronizer.createCheckpointCommit(
        activeRepoPath,
        shadowTaskId,
        `final-${attempt}`,
      )) || checkpointRef.baseRef;

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
      message: `Apply-back completed successfully for attempt ${attempt}`,
      timestamp: new Date(),
    });

    return { success: true, skipped: false, telemetry: applyBackTelemetry };
  } catch (error) {
    const sanitizedErr = sanitizeError(error);
    recordAuditEvent(
      'apply_back.failure',
      {
        attempt,
        changedFiles: params.changedFiles.length,
        telemetry: applyBackTelemetry,
        error: sanitizedErr,
      },
      { phase: 'APPLY_BACK', severity: 'high', scope: 'session' },
    );
    emit?.({
      type: 'log',
      level: 'error',
      message: `Apply-back failed on attempt ${attempt}: ${sanitizedErr}`,
      timestamp: new Date(),
    });
    return { success: false, skipped: false, telemetry: applyBackTelemetry, error: sanitizedErr };
  }
}
