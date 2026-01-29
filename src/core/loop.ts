import { randomBytes } from 'crypto';

import { text } from '../locales/index.js';

import { GitAdapter } from './adapters/git/git-adapter.js';
import { Semaphore } from './concurrency.js';
import { executeSalmonLoopFlow } from './grizzco/flows/SalmonLoopFlow.js';
import { LIMITS } from './limits.js';
import { FileStateResolver } from './strata/layers/file-state-resolver.js';
import { RuntimeEnvironment } from './strata/runtime/environment.js';
import { WorkspaceSynchronizer } from './strata/runtime/synchronizer.js';
import {
  ExecutionPhase,
  Phase,
  ErrorType,
  type LoopEvent,
  type LoopIteration,
  type LoopOptions,
  type LoopResult,
  type StepLog,
} from './types.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

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
 * SalmonLoop Execution Kernel (V3 Powered)
 */
export class SalmonLoop {
  async run(options: LoopOptions): Promise<LoopResult> {
    const emit = (event: LoopEvent) => options.onEvent?.(event);
    const now = () => new Date();
    const logs: StepLog[] = [];
    const history: LoopIteration[] = [];

    const wrappedEmit = (event: LoopEvent) => {
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

    try {
      await env.setup();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
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
      };
    }

    const activeRepoPath = env.activeRepoPath;
    const checkpointManager = env.checkpointManager;
    const synchronizer = new WorkspaceSynchronizer(checkpointManager);
    const git = new GitAdapter(activeRepoPath);
    const resolver = new FileStateResolver(git, activeRepoPath);

    let retries = 0;
    let currentContext: any = undefined;
    let shadowLatestRef: string | null = null;
    const shadowTaskId = randomBytes(4).toString('hex');

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

      while (retries <= LIMITS.maxRetries) {
        const attempt = retries + 1;

        // Execute V3 Flow
        const result = await executeSalmonLoopFlow({
          workspace: env.workspace!,
          options: options,
          emit: loopEmit,
          fileStateResolver: resolver,
          // 🛡️ HANDOVER: Pass the physical snapshot hash to the logical flow layer
          // to ensure transactional integrity and rollback capability.
          shadowInitialRef: env.initialSnapshotHash!,
          attempt,
          initialContext: currentContext,
        });

        // Map V3 Result to LoopIteration
        const ctx = result.data; // Final context (ShrinkCtx or VerifyCtx)

        history.push({
          attempt,
          plan: ctx?.plan,
          patch: ctx?.diff,
          error: result.error?.message || ctx?.lastError,
          contextSummary: ctx?.context
            ? `Snippets: ${ctx.context.rgSnippets.length}`
            : 'No context',
        });

        if (result.success) {
          // Success means Pipeline finished (Verify passed)
          // Double check verify result just in case
          const verifyOk = ctx?.verifyResult?.ok !== false;

          if (verifyOk) {
            if (options.dryRun) {
              return {
                success: true,
                reason: text.loop.operationCompleted,
                reasonCode: 'DRY_RUN',
                attempts: attempt,
                logs,
                history,
                finalPatch: ctx?.diff || undefined,
                changedFiles: ctx?.changedFiles || [],
              };
            }

            const currentDiff = ctx?.diff;
            const changedFilesThisAttempt = ctx?.changedFiles || [];

            if (env.checkpointRef && options.strategy === 'worktree') {
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
                );
              } catch (error) {
                const msg = `Failed to apply changes back to main workspace: ${error instanceof Error ? error.message : String(error)}`;
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
            };
          }
        }

        // Failure or Verify Failed
        if (ctx?.shrunk && ctx?.context) {
          currentContext = ctx.context;
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
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
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
      };
    } finally {
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
