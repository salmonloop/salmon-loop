import type { Context, Plan, LoopResult, StepLog, RunOptions, LoopIteration } from './types.js';
import { ExecutionPhase } from './types.js';
import { ContextBuilder } from './context.js';
import { LLM } from './llm.js';
import { validateDiff } from './diff.js';
import { applyPatch, rollbackFiles } from './git.js';
import { runVerify, classifyError } from './verify.js';
import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';

export interface LoopOptions {
  instruction: string;
  verify: string;
  repo: string;
  llm: LLM;
  dryRun?: boolean;
  forceReset?: boolean;
}


/**
 * SalmonLoop Execution Kernel
 *
 * Phase Guarantees:
 * 1. PLAN: Read-only. Never mutates filesystem.
 * 2. PATCH: Read-only. Generates changes in memory.
 * 3. VALIDATE: Read-only. Enforces limits and safety rules.
 * 4. APPLY: Mutating. The ONLY phase that writes to disk.
 * 5. VERIFY: Read-only. Runs checks without modifying code.
 * 6. ROLLBACK: Mutating. Restores state on failure.
 * 7. SHRINK: Read-only. Reduces context for next attempt.
 */
export class SalmonLoop {
  async run(options: LoopOptions): Promise<LoopResult> {
    const logs: StepLog[] = [];
    const history: LoopIteration[] = [];
    let context: Context;

    try {
      context = await ContextBuilder.build({
        instruction: options.instruction,
        verify: options.verify,
        repo: options.repo,
        file: undefined,
        selection: undefined,
        dryRun: options.dryRun,
        verbose: false
      });
    } catch (error) {
      logs.push(this.createLog('error', error instanceof Error ? error.message : String(error), false));
      return {
        success: false,
        reason: text.loop.loopExecutionFailed,
        attempts: 0,
        logs,
        failurePhase: ExecutionPhase.PLAN
      };
    }
    
    let currentPlan: Plan | null = null;
    let currentDiff: string | null = null;
    let retries = 0;
    let lastError: string | undefined;
    let changedFilesThisAttempt: string[] = [];

    while (retries <= LIMITS.maxRetries) {
      changedFilesThisAttempt = []; // Reset for this attempt
      try {
        // PLAN phase
        currentPlan = await options.llm.createPlan(context, options.instruction, lastError);
        logs.push(this.createLog(ExecutionPhase.PLAN, currentPlan));

        // PATCH phase
        currentDiff = await options.llm.createPatch(context, currentPlan, lastError);
        logs.push(this.createLog(ExecutionPhase.PATCH, currentDiff));

        // VALIDATE phase
        const diffMeta = validateDiff(currentDiff);
        changedFilesThisAttempt = diffMeta.changedFiles;
        logs.push(this.createLog(ExecutionPhase.VALIDATE, text.loop.diffValidationPassed));

        // APPLY phase
        if (!options.dryRun) {
          await applyPatch(options.repo, currentDiff);
          logs.push(this.createLog(ExecutionPhase.APPLY, text.loop.patchApplied));
        } else {
          logs.push(this.createLog(ExecutionPhase.APPLY, text.loop.dryRunPatchNotApplied));
        }

        // VERIFY phase
        const verifyResult = await runVerify(options.repo, options.verify);
        logs.push(this.createLog(ExecutionPhase.VERIFY, verifyResult.output, verifyResult.ok));

        if (verifyResult.ok) {
          return {
            success: true,
            reason: text.loop.operationCompleted,
            attempts: retries + 1,
            logs,
            history,
            finalPatch: currentDiff || undefined
          };
        }

        // Verification failed, preparing to retry
        lastError = verifyResult.output;

        // Record history
        history.push({
          attempt: retries + 1,
          plan: currentPlan,
          patch: currentDiff,
          error: lastError,
          contextSummary: `Snippets: ${context.rgSnippets.length}, Diff: ${!!context.gitDiff}`
        });

        retries++;

        // Rollback files (using changedFilesThisAttempt)
        if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
          const rb = await rollbackFiles(options.repo, changedFilesThisAttempt, options.forceReset);
          if (!rb.ok) {
            logs.push(this.createLog(ExecutionPhase.ROLLBACK, text.loop.rollbackFailed(rb.stderr), false));
            return {
              success: false,
              reason: text.loop.rollbackFailedDirty,
              attempts: retries,
              logs,
              history,
              finalPatch: currentDiff || undefined,
              failurePhase: ExecutionPhase.ROLLBACK
            };
          } else {
            const msg = options.forceReset ? text.loop.rollbackAllSuccess : text.loop.rollbackSuccess(changedFilesThisAttempt);
            logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg));
          }
        }

        if (retries > LIMITS.maxRetries) {
          return {
            success: false,
            reason: text.loop.exceededMaxRetriesSimple,
            attempts: retries,
            logs,
            history,
            finalPatch: currentDiff || undefined,
            failurePhase: ExecutionPhase.VERIFY
          };
        }

        // Shrink context
        const errorType = classifyError(verifyResult.output);
        const failedFiles = ContextBuilder.extractFailedFiles(verifyResult.output);
        context = await ContextBuilder.shrinkContext(context, failedFiles, errorType);
        logs.push(this.createLog(ExecutionPhase.SHRINK, text.loop.contextShrunk));

      } catch (error) {
        // Rollback on error
        let failurePhase = ExecutionPhase.PLAN;
        if (currentDiff) failurePhase = ExecutionPhase.APPLY;
        else if (currentPlan) failurePhase = ExecutionPhase.PATCH;

        if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
          const rb = await rollbackFiles(options.repo, changedFilesThisAttempt, options.forceReset);
          if (!rb.ok) {
            logs.push(this.createLog(ExecutionPhase.ROLLBACK, text.loop.rollbackFailed(rb.stderr), false));
            failurePhase = ExecutionPhase.ROLLBACK;
          } else {
            const msg = options.forceReset ? text.loop.rollbackAllSuccess : text.loop.rollbackSuccess(changedFilesThisAttempt);
            logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg));
          }
        }

        logs.push(this.createLog('error', error instanceof Error ? error.message : String(error), false));
        
        return {
          success: false,
          reason: text.loop.loopExecutionFailed,
          attempts: retries + 1,
          logs,
          history,
          finalPatch: currentDiff || undefined,
          failurePhase
        };
      }
    }

    return {
      success: false,
      reason: text.loop.unexpectedTermination,
      attempts: retries,
      logs,
      history,
      finalPatch: currentDiff || undefined
    };
  }

  private createLog(step: ExecutionPhase | 'error', output: any, success = true): StepLog {
    return {
      step,
      success,
      output: typeof output === 'string' ? output : JSON.stringify(output),
      timestamp: new Date()
    };
  }
}
