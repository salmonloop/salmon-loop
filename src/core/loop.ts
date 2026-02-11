import { randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';

import { text } from '../locales/index.js';

import { createFileSystemAdapter } from './adapters/fs/index.js';
import { GitAdapter } from './adapters/git/git-adapter.js';
import { clearAuditContext, clearAuditTrail, setAuditContext } from './audit-trail.js';
import { Semaphore } from './concurrency.js';
import { executeSalmonLoopFlow } from './grizzco/flows/SalmonLoopFlow.js';
import type { ShrinkCtx } from './grizzco/types.js';
import { LIMITS } from './limits.js';
import { sanitizeError } from './llm/errors.js';
import { logger } from './logger.js';
import { FileStateResolver } from './strata/layers/file-state-resolver.js';
import { RuntimeEnvironment } from './strata/runtime/environment.js';
import { WorkspaceSynchronizer } from './strata/runtime/synchronizer.js';
import type { ApplyBackTelemetry } from './strata/runtime/synchronizer.js';
import type { ArtifactHandle } from './sub-agent/artifacts/types.js';
import {
  ExecutionPhase,
  Phase,
  ErrorType,
  FlowMode,
  type LoopEvent,
  type LoopIteration,
  type LoopOptions,
  type LoopResult,
  type StepLog,
  type AuthorizationSourceSummary,
} from './types.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

function buildAuthorizationSummary(logs: unknown[] | undefined): AuthorizationSourceSummary | null {
  if (!logs || logs.length === 0) return null;

  const summary: AuthorizationSourceSummary = {
    auto: 0,
    allowlist: 0,
    user: 0,
    cache: 0,
  };
  let hasEntries = false;

  for (const entry of logs) {
    if (!entry || (entry as any).eventType !== 'authorization') continue;
    const source = (entry as any).authSource;
    if (source === 'auto') {
      summary.auto += 1;
      hasEntries = true;
    } else if (source === 'allowlist') {
      summary.allowlist += 1;
      hasEntries = true;
    } else if (source === 'user') {
      summary.user += 1;
      hasEntries = true;
    } else if (source === 'cache') {
      summary.cache += 1;
      hasEntries = true;
    }
  }

  return hasEntries ? summary : null;
}

/**
 * Main entry point for running the SalmonLoop.
 *
 * @param options - The options for the loop.
 * @returns The result of the loop execution.
 */
export async function runSalmonLoop(options: LoopOptions): Promise<LoopResult> {
  return globalSemaphore.run(async () => {
    const loop = new SalmonLoop();
    return loop.run(options);
  });
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

/**
 * SalmonLoop Execution Kernel (Bifrost-powered)
 */
export class SalmonLoop {
  private async appendApplyBackAudit(
    auditPath: string | undefined,
    payload: {
      attempt: number;
      success: boolean;
      telemetry: ApplyBackTelemetry;
      error?: string;
    },
  ): Promise<void> {
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

  async run(options: LoopOptions): Promise<LoopResult> {
    clearAuditTrail();
    const correlationId = `run-${randomBytes(4).toString('hex')}`;
    setAuditContext({ correlationId, scope: 'session' });
    const emit = (event: LoopEvent) => options.onEvent?.(event);
    const now = () => new Date();
    const logs: StepLog[] = [];
    const history: LoopIteration[] = [];
    const flowMode: FlowMode = options.mode ?? 'patch';
    const fsAdapter = createFileSystemAdapter(flowMode);

    const wrappedEmit = (event: LoopEvent) => {
      // 🛡️ SECURITY GUARD: Sanitize any error messages being emitted
      if (event.type === 'log' && event.level === 'error') {
        event.message = sanitizeError(event.message);
      }
      emit(event);
      if (event.type === 'log') {
        logs.push({
          step: 'PREFLIGHT',
          success: event.level !== 'error',
          output: event.message,
          timestamp: event.timestamp,
        });
      }
    };

    const env = new RuntimeEnvironment(options, wrappedEmit);
    let setupSucceeded = false;

    try {
      await env.setup();
      setupSucceeded = true;
    } catch (error) {
      const msg = sanitizeError(error);
      const errorCode = (error as any)?.llmCode || (error as any)?.code || (error as any)?.name;
      logs.push(this.createLog(Phase.PREFLIGHT, msg, false));
      emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
      return {
        success: false,
        reason: msg,
        reasonCode: 'LOOP_FAILED',
        attempts: 0,
        logs,
        failurePhase: Phase.PREFLIGHT,
        errorType: ErrorType.UNKNOWN,
        errorCode,
        strategyName: flowMode,
        fsMode: flowMode,
      };
    } finally {
      if (!setupSucceeded) {
        clearAuditContext();
        try {
          await env.teardown();
        } catch (teardownError) {
          logger.warn(
            `[Runtime] Failed to teardown after setup error: ${sanitizeError(teardownError)}`,
          );
        }
      }
    }

    const activeRepoPath = env.activeRepoPath;

    // Broadcast workspace information to UI listeners
    emit({
      type: 'workspace.ready',
      path: activeRepoPath,
      strategy: options.strategy || 'local',
      timestamp: now(),
    });

    const checkpointManager = env.checkpointManager;
    const synchronizer = new WorkspaceSynchronizer(checkpointManager);
    const git = new GitAdapter(activeRepoPath);
    const resolver = new FileStateResolver(git, activeRepoPath);

    let retries = 0;
    let currentContext: any = undefined;
    let currentLastError: string | undefined = undefined;
    let shadowLatestRef: string | null = null;
    const shadowTaskId = randomBytes(4).toString('hex');
    let authorizationSummary: AuthorizationSourceSummary | null = null;

    try {
      let currentPhase: string = 'UNKNOWN';
      const loopEmit = (event: LoopEvent) => {
        emit(event);
        if (event.type === 'phase.start') {
          currentPhase = event.phase;
        }
        if (event.type === 'log') {
          logs.push({
            step: (currentPhase as ExecutionPhase) || 'UNKNOWN',
            success: event.level !== 'error',
            output: event.message,
            timestamp: event.timestamp,
          });
        }
      };

      let verifyArtifact: ArtifactHandle | undefined;

      while (retries <= LIMITS.maxRetries) {
        // Check for cancellation
        if (options.signal?.aborted) {
          return {
            success: false,
            reason: 'Operation cancelled by user',
            reasonCode: 'LOOP_CRASH',
            attempts: retries,
            logs,
            history,
            errorType: ErrorType.UNKNOWN,
            strategyName: flowMode,
            fsMode: flowMode,
          };
        }

        const attempt = retries + 1;

        // Execute Bifrost flow
        const result = await executeSalmonLoopFlow({
          workspace: env.workspace!,
          options: options,
          mode: flowMode,
          fs: fsAdapter,
          emit: loopEmit,
          fileStateResolver: resolver,
          // 🛡️ HANDOVER: Pass the physical snapshot hash to the logical flow layer
          // to ensure transactional integrity and rollback capability.
          shadowInitialRef: env.initialSnapshotHash!,
          attempt,
          initialContext: currentContext,
          lastError: currentLastError,
        });

        // Map flow result to LoopIteration
        const ctx = result.data as Partial<ShrinkCtx> | undefined;
        authorizationSummary = buildAuthorizationSummary(
          ctx?.toolAuditLogger?.getLogs?.() as unknown[],
        );
        const errorCode =
          (result.error as any)?.llmCode ||
          (result.error as any)?.code ||
          (result.error as any)?.name;

        history.push({
          attempt,
          plan: ctx?.plan ?? null,
          patch: ctx?.diff ?? null,
          error: sanitizeError(result.error || ctx?.lastError),
          contextSummary: ctx?.context
            ? `Snippets: ${ctx.context.rgSnippets.length}`
            : 'No context',
        });

        const artifactCandidate = ctx?.verifyArtifact as ArtifactHandle | undefined;
        if (artifactCandidate) {
          verifyArtifact = artifactCandidate;
        }

        if (result.success) {
          // Success means Pipeline finished (Verify passed)
          // Double check verify result just in case
          const verifyOk = flowMode === 'review' ? true : ctx?.verifyResult?.ok !== false;

          if (verifyOk) {
            const skipApplyBack = options.dryRun || flowMode === 'review';
            if (skipApplyBack) {
              return {
                success: true,
                reason: text.loop.operationCompleted,
                reasonCode: options.dryRun ? 'DRY_RUN' : 'SUCCESS',
                attempts: attempt,
                logs,
                history,
                finalPatch: ctx?.diff || undefined,
                changedFiles: ctx?.changedFiles || [],
                auditPath: result.auditPath,
                verifyArtifact,
                authorizationSummary: authorizationSummary || undefined,
                strategyName: result.strategyName ?? flowMode,
                fsMode: result.fsMode ?? flowMode,
              };
            }

            const currentDiff = ctx?.diff;
            const changedFilesThisAttempt = ctx?.changedFiles || [];

            if (env.checkpointRef && options.strategy === 'worktree') {
              const applyBackTelemetry: ApplyBackTelemetry = {};
              try {
                const finalRef =
                  (await synchronizer.createCheckpointCommit(
                    activeRepoPath,
                    shadowTaskId,
                    `final-${attempt}`,
                  )) || env.checkpointRef.baseRef;
                shadowLatestRef = finalRef;

                await synchronizer.applyBackToMainWorkspace(
                  options.repoPath,
                  env.checkpointRef,
                  currentDiff || '',
                  options.applyBackOnDirty ?? '3way',
                  options.verbose,
                  changedFilesThisAttempt,
                  env.initialSnapshotHash,
                  shadowLatestRef,
                  collectSidecarPaths(options),
                  applyBackTelemetry,
                );
                await this.appendApplyBackAudit(result.auditPath, {
                  attempt,
                  success: true,
                  telemetry: applyBackTelemetry,
                });
              } catch (error) {
                const sanitizedErr = sanitizeError(error);
                await this.appendApplyBackAudit(result.auditPath, {
                  attempt,
                  success: false,
                  telemetry: applyBackTelemetry,
                  error: sanitizedErr,
                });
                const msg = `Failed to apply changes back to main workspace: ${sanitizedErr}`;
                logs.push(this.createLog('error', msg, false));
                emit({ type: 'log', level: 'error', message: msg, timestamp: now() });

                return {
                  success: false,
                  reason: msg,
                  reasonCode: 'APPLY_BACK_FAILED',
                  attempts: attempt,
                  logs,
                  history,
                  failurePhase: Phase.VERIFY,
                  errorType: ErrorType.UNKNOWN,
                  auditPath: result.auditPath,
                  authorizationSummary: authorizationSummary || undefined,
                  strategyName: result.strategyName ?? flowMode,
                  fsMode: result.fsMode ?? flowMode,
                };
              }
            }

            return {
              success: true,
              reason: text.loop.operationCompleted,
              reasonCode: 'SUCCESS',
              attempts: attempt,
              logs,
              history,
              finalPatch: currentDiff || undefined,
              changedFiles: changedFilesThisAttempt,
              auditPath: result.auditPath,
              verifyArtifact,
              authorizationSummary: authorizationSummary || undefined,
              strategyName: result.strategyName ?? flowMode,
              fsMode: result.fsMode ?? flowMode,
            };
          }
        }

        // Failure or Verify Failed
        if (ctx?.shrunk && ctx?.context) {
          currentContext = ctx.context;
          currentLastError = ctx.lastError || currentLastError;
        }

        retries++;

        if (retries > LIMITS.maxRetries) {
          return {
            success: false,
            reason: text.loop.exceededMaxRetriesSimple,
            reasonCode: 'MAX_RETRIES',
            attempts: retries,
            logs,
            history,
            failurePhase: Phase.VERIFY,
            errorType: ErrorType.UNKNOWN,
            errorCode,
            auditPath: result.auditPath,
            verifyArtifact,
            authorizationSummary: authorizationSummary || undefined,
            strategyName: result.strategyName ?? flowMode,
            fsMode: result.fsMode ?? flowMode,
          };
        }
      }

      return {
        success: false,
        reason: text.loop.exceededMaxRetriesSimple,
        reasonCode: 'MAX_RETRIES',
        attempts: retries,
        logs,
        history,
        errorType: ErrorType.UNKNOWN,
        verifyArtifact,
        authorizationSummary: authorizationSummary || undefined,
        strategyName: flowMode,
        fsMode: flowMode,
      };
    } catch (error) {
      const msg = sanitizeError(error);
      const errorCode = (error as any)?.llmCode || (error as any)?.code || (error as any)?.name;
      logs.push(this.createLog('error', msg, false));
      emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
      return {
        success: false,
        reason: msg,
        reasonCode: 'LOOP_CRASH',
        attempts: retries,
        logs,
        history,
        errorType: ErrorType.UNKNOWN,
        errorCode,
        authorizationSummary: authorizationSummary || undefined,
        strategyName: flowMode,
        fsMode: flowMode,
      };
    } finally {
      clearAuditContext();
      await env.teardown();
    }
  }

  private createLog(step: ExecutionPhase | 'error', output: any, success = true): StepLog {
    let outputStr =
      typeof output === 'string'
        ? output
        : (() => {
            try {
              return JSON.stringify(output);
            } catch {
              try {
                return String(output);
              } catch {
                return '[Unserializable]';
              }
            }
          })();

    if (outputStr.length > LIMITS.maxLogLength) {
      outputStr = outputStr.substring(0, LIMITS.maxLogLength) + '\n...[Truncated due to length]...';
    }

    return {
      step,
      success,
      output: outputStr,
      timestamp: new Date(),
    };
  }
}
