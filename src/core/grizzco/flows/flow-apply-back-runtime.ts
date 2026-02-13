import { readFile, writeFile } from 'fs/promises';

import { recordAuditEvent } from '../../audit-trail.js';
import { sanitizeError } from '../../llm/errors.js';
import { logger } from '../../logger.js';
import { WorkspaceSynchronizer } from '../../strata/runtime/synchronizer.js';
import type { ApplyBackTelemetry } from '../../strata/runtime/synchronizer.js';
import type { CheckpointRef, LoopEvent, LoopOptions } from '../../types.js';

export interface ApplyBackPhaseParams {
  attempt: number;
  options: LoopOptions;
  checkpointRef?: CheckpointRef;
  initialSnapshotHash?: string;
  synchronizer: WorkspaceSynchronizer;
  activeRepoPath: string;
  shadowTaskId: string;
  emit?: (event: LoopEvent) => void;
  auditPath?: string;
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
    auditPath,
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

    await appendApplyBackAudit(auditPath, {
      attempt,
      success: true,
      telemetry: applyBackTelemetry,
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
    await appendApplyBackAudit(auditPath, {
      attempt,
      success: false,
      telemetry: applyBackTelemetry,
      error: sanitizedErr,
    });
    return { success: false, skipped: false, telemetry: applyBackTelemetry, error: sanitizedErr };
  }
}

function collectSidecarPaths(options: LoopOptions): string[] {
  if (!options.contextFiles || options.contextFiles.length === 0) {
    return [];
  }
  const paths = new Set<string>();
  for (const filePath of options.contextFiles) {
    if (filePath) paths.add(filePath);
  }
  return Array.from(paths);
}

async function appendApplyBackAudit(
  auditPath: string | undefined,
  payload: {
    attempt: number;
    success: boolean;
    telemetry: ApplyBackTelemetry;
    error?: string;
  },
) {
  if (!auditPath) return;
  try {
    const raw = await readFile(auditPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const previous = Array.isArray(data.applyBackAudit) ? data.applyBackAudit : [];
    data.applyBackAudit = [
      ...previous,
      {
        ...payload,
        timestamp: new Date().toISOString(),
      },
    ];
    await writeFile(auditPath, JSON.stringify(data, null, 2));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[Audit] Failed to append apply-back telemetry: ${msg}`);
  }
}
