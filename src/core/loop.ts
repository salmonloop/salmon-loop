import type {
  Context,
  Plan,
  LoopResult,
  StepLog,
  LoopIteration,
  LoopEvent,
  VerboseLevel,
} from './types.js';
import { ExecutionPhase, ErrorType } from './types.js';
import { ContextBuilder } from './context.js';
import { LLM } from './llm.js';
import { validateDiff, normalizeDiff } from './diff.js';
import { applyPatch, rollbackFiles, getGitStatus } from './git.js';
import { runVerify, classifyError, preflight } from './verify.js';
import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';

export interface LoopOptions {
  /**
   * The instruction for the LLM to follow.
   */
  instruction: string;
  /**
   * The verification command to run after applying the patch.
   */
  verify: string;
  /**
   * The absolute path to the git repository.
   */
  repoPath: string;
  /**
   * The LLM instance to use for planning and patching.
   */
  llm: LLM;
  /**
   * If true, the patch will not be applied to the filesystem.
   */
  dryRun?: boolean;
  /**
   * If true, the repository will be reset to HEAD on failure.
   */
  forceReset?: boolean;
  /**
   * Callback for events emitted during the loop.
   */
  onEvent?: (event: LoopEvent) => void;
  /**
   * If true, the loop will run even if the workspace has uncommitted changes.
   */
  allowDirty?: boolean;
  /**
   * The verbose level for logging.
   */
  verbose?: VerboseLevel;
}

/**
 * Main entry point for running the SalmonLoop.
 *
 * @param options - The options for the loop.
 * @returns The result of the loop execution.
 */
export async function runSalmonLoop(options: LoopOptions): Promise<LoopResult> {
  const loop = new SalmonLoop();
  return loop.run(options);
}

/**
 * SalmonLoop Execution Kernel
 *
 * Phase Guarantees:
 * 1. PREFLIGHT: Read-only. Checks environment safety.
 * 2. CONTEXT: Read-only. Gathers codebase context.
 * 3. PLAN: Read-only. Never mutates filesystem.
 * 4. PATCH: Read-only. Generates changes in memory.
 * 5. VALIDATE: Read-only. Enforces limits and safety rules.
 * 6. APPLY: Mutating. The ONLY phase that writes to disk.
 * 7. VERIFY: Read-only. Runs checks without modifying code.
 * 8. ROLLBACK: Mutating. Restores state on failure.
 * 9. SHRINK: Read-only. Reduces context for next attempt.
 */
export class SalmonLoop {
  async run(options: LoopOptions): Promise<LoopResult> {
    const emit = (event: LoopEvent) => options.onEvent?.(event);
    const now = () => new Date();

    const logs: StepLog[] = [];
    const history: LoopIteration[] = [];
    let context: Context;
    let currentPhase: ExecutionPhase = ExecutionPhase.PREFLIGHT;
    let phaseEnded = true;

    const startPhase = (phase: ExecutionPhase) => {
      // Ensure previous phase is closed
      if (!phaseEnded) {
        endPhase(false);
      }
      currentPhase = phase;
      phaseEnded = false;
      emit({ type: 'phase.start', phase, timestamp: now() });
    };

    const endPhase = (success: boolean) => {
      if (!phaseEnded) {
        emit({ type: 'phase.end', phase: currentPhase, success, timestamp: now() });
        phaseEnded = true;
      }
    };

    // Safety Guard: Prevent accidental loss of uncommitted changes
    if (options.allowDirty && options.forceReset) {
      const reason = text.loop.forceResetNotAllowedWithDirty;
      logs.push(this.createLog('error', reason, false));
      emit({ type: 'log', level: 'error', message: reason, timestamp: now() });
      return {
        success: false,
        reason,
        reasonCode: 'PREFLIGHT_DIRTY',
        attempts: 0,
        logs,
        failurePhase: ExecutionPhase.PREFLIGHT,
        errorType: ErrorType.UNKNOWN,
      };
    }

    // Preflight checks
    if (!options.allowDirty) {
      startPhase(ExecutionPhase.PREFLIGHT);
      const pf = await preflight(options.repoPath);
      if (!pf.ok) {
        const reason = pf.reason || text.loop.preflightFailedNotGit;

        logs.push(this.createLog('error', reason, false));
        endPhase(false);
        emit({ type: 'log', level: 'error', message: reason, timestamp: now() });

        return {
          success: false,
          reason,
          reasonCode: pf.reason?.includes('git command not found')
            ? 'LOOP_FAILED'
            : pf.reason?.includes('Not a git repository')
              ? 'PREFLIGHT_NOT_GIT'
              : 'PREFLIGHT_DIRTY',
          attempts: 0,
          logs,
          failurePhase: ExecutionPhase.PREFLIGHT,
          errorType: ErrorType.UNKNOWN,
        };
      }
      endPhase(true);
    }

    try {
      startPhase(ExecutionPhase.CONTEXT);
      context = await ContextBuilder.build({
        instruction: options.instruction,
        verify: options.verify,
        repoPath: options.repoPath,
        file: undefined,
        selection: undefined,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
      emit({
        type: 'log',
        level: 'debug',
        message: `Context built: ${context.rgSnippets.length} snippets, diff: ${!!context.gitDiff}`,
        timestamp: now(),
      });
      if (!context.primaryText && context.rgSnippets.length === 0 && !context.gitDiff) {
        const warnMsg =
          'Warning: No context gathered. The LLM may not have enough information to generate a correct patch. Consider using --file or installing ripgrep.';
        logs.push(this.createLog(ExecutionPhase.CONTEXT, warnMsg, true));
        emit({ type: 'log', level: 'warn', message: warnMsg, timestamp: now() });
      }
      endPhase(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logs.push(this.createLog('error', msg, false));
      endPhase(false);
      emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
      return {
        success: false,
        reason: text.loop.loopExecutionFailed,
        reasonCode: 'LOOP_FAILED',
        attempts: 0,
        logs,
        failurePhase: ExecutionPhase.CONTEXT,
        errorType: ErrorType.UNKNOWN,
      };
    }

    let currentPlan: Plan | null = null;
    let currentDiff: string | null = null;
    let retries = 0;
    let lastError: string | undefined;
    let changedFilesThisAttempt: string[] = [];

    while (retries <= LIMITS.maxRetries) {
      const attempt = retries + 1;
      changedFilesThisAttempt = []; // Reset for this attempt
      try {
        // PLAN phase
        startPhase(ExecutionPhase.PLAN);
        currentPlan = await options.llm.createPlan(context, options.instruction, lastError);
        emit({
          type: 'log',
          level: 'debug',
          message: `Plan generated: ${currentPlan.goal}`,
          timestamp: now(),
        });
        logs.push(this.createLog(ExecutionPhase.PLAN, currentPlan));
        endPhase(true);

        // PATCH phase
        startPhase(ExecutionPhase.PATCH);
        currentDiff = await options.llm.createPatch(context, currentPlan, lastError);
        emit({
          type: 'log',
          level: 'debug',
          message: `Patch generated, length: ${currentDiff.length}`,
          timestamp: now(),
        });
        logs.push(this.createLog(ExecutionPhase.PATCH, currentDiff));
        endPhase(true);

        // VALIDATE phase
        startPhase(ExecutionPhase.VALIDATE);
        const diffMeta = validateDiff(currentDiff);
        // Use normalized diff for application to remove markdown markers or conversational text
        currentDiff = normalizeDiff(currentDiff);
        changedFilesThisAttempt = diffMeta.changedFiles;
        logs.push(this.createLog(ExecutionPhase.VALIDATE, text.loop.diffValidationPassed));
        emit({
          type: 'diff.meta',
          changedFiles: changedFilesThisAttempt,
          fileCount: diffMeta.fileCount,
          lineCount: diffMeta.lineCount,
          timestamp: now(),
        });
        endPhase(true);

        // DRY RUN: stop after validation (preview mode)
        if (options.dryRun) {
          logs.push(this.createLog(ExecutionPhase.APPLY, text.loop.dryRunPatchNotApplied));
          return {
            success: true,
            reason: text.loop.dryRunCompleted,
            reasonCode: 'DRY_RUN',
            attempts: attempt,
            logs,
            history,
            finalPatch: currentDiff || undefined,
            changedFiles: changedFilesThisAttempt,
          };
        }

        // APPLY phase
        startPhase(ExecutionPhase.APPLY);
        try {
          if (!currentDiff) throw new Error(text.llm.patchEmpty());
          await applyPatch(options.repoPath, currentDiff);
          logs.push(this.createLog(ExecutionPhase.APPLY, text.loop.patchApplied));
          endPhase(true);
        } catch (e) {
          endPhase(false);
          throw e;
        }

        // VERIFY phase
        startPhase(ExecutionPhase.VERIFY);
        const verifyResult = await runVerify(options.repoPath, options.verify);
        logs.push(this.createLog(ExecutionPhase.VERIFY, verifyResult.output, verifyResult.ok));
        emit({
          type: 'verify.result',
          ok: verifyResult.ok,
          output: verifyResult.output,
          timestamp: now(),
        });
        endPhase(verifyResult.ok);

        if (verifyResult.ok) {
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

        // Verification failed, preparing to retry
        lastError = verifyResult.output;
        const errorType = classifyError(verifyResult.output);
        const failedFiles = ContextBuilder.extractFailedFiles(verifyResult.output);
        emit({
          type: 'retry',
          fromAttempt: attempt,
          toAttempt: attempt + 1,
          // Truncate reason to avoid bloating event stream
          reason: lastError.length > 2000 ? lastError.substring(0, 2000) + '...' : lastError,
          failedFiles,
          timestamp: now(),
        });

        // Record history
        history.push({
          attempt,
          plan: currentPlan,
          patch: currentDiff,
          error: lastError,
          contextSummary: `Snippets: ${context.rgSnippets.length}, Diff: ${!!context.gitDiff}`,
        });

        retries++;

        // Rollback files (using changedFilesThisAttempt)
        // Safety: Never rollback in dryRun mode
        if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
          startPhase(ExecutionPhase.ROLLBACK);
          const rb = await rollbackFiles(
            options.repoPath,
            changedFilesThisAttempt,
            options.forceReset,
          );
          if (!rb.ok) {
            endPhase(false);
            const status = await getGitStatus(options.repoPath);
            const errorMsg = status ? `${rb.stderr}\n\nGit Status:\n${status}` : rb.stderr;
            logs.push(
              this.createLog(ExecutionPhase.ROLLBACK, text.loop.rollbackFailed(errorMsg), false),
            );
            return {
              success: false,
              reason: text.loop.rollbackFailedDirty,
              reasonCode: 'ROLLBACK_FAILED',
              attempts: attempt, // Current attempt failed during rollback
              logs,
              history,
              finalPatch: currentDiff || undefined,
              failurePhase: ExecutionPhase.ROLLBACK,
              errorType,
            };
          } else {
            const msg = options.forceReset
              ? text.loop.rollbackAllSuccess
              : text.loop.rollbackSuccess(changedFilesThisAttempt);
            logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg));
            endPhase(true);
          }
        }

        if (retries > LIMITS.maxRetries) {
          return {
            success: false,
            reason: text.loop.exceededMaxRetriesSimple,
            reasonCode: 'MAX_RETRIES',
            attempts: attempt, // Total attempts made (last one failed)
            logs,
            history,
            finalPatch: currentDiff || undefined,
            failurePhase: ExecutionPhase.VERIFY,
            errorType,
          };
        }

        // Shrink context
        startPhase(ExecutionPhase.SHRINK);
        context = await ContextBuilder.shrinkContext(context, failedFiles, errorType);
        logs.push(this.createLog(ExecutionPhase.SHRINK, text.loop.contextShrunk));
        endPhase(true);
      } catch (error) {
        // Rollback on error
        let failurePhase: ExecutionPhase = currentPhase;
        endPhase(false);

        // Safety: Never rollback in dryRun mode
        if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
          startPhase(ExecutionPhase.ROLLBACK);
          const rb = await rollbackFiles(
            options.repoPath,
            changedFilesThisAttempt,
            options.forceReset,
          );
          if (!rb.ok) {
            const status = await getGitStatus(options.repoPath);
            const errorMsg = status ? `${rb.stderr}\n\nGit Status:\n${status}` : rb.stderr;
            logs.push(
              this.createLog(ExecutionPhase.ROLLBACK, text.loop.rollbackFailed(errorMsg), false),
            );
            failurePhase = ExecutionPhase.ROLLBACK;
            endPhase(false);
          } else {
            const msg = options.forceReset
              ? text.loop.rollbackAllSuccess
              : text.loop.rollbackSuccess(changedFilesThisAttempt);
            logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg));
            endPhase(true);
          }
        }

        const msg = error instanceof Error ? error.message : String(error);
        logs.push(this.createLog('error', msg, false));
        emit({ type: 'log', level: 'error', message: msg, timestamp: now() });

        return {
          success: false,
          reason: text.loop.loopExecutionFailed,
          reasonCode: 'LOOP_FAILED',
          attempts: attempt, // Current attempt failed
          logs,
          history,
          finalPatch: currentDiff || undefined,
          failurePhase,
          errorType: ErrorType.UNKNOWN,
        };
      }
    }

    return {
      success: false,
      reason: text.loop.unexpectedTermination,
      reasonCode: 'LOOP_FAILED',
      attempts: retries, // No new attempt started after the loop
      logs,
      history,
      finalPatch: currentDiff || undefined,
      errorType: ErrorType.UNKNOWN,
    };
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
