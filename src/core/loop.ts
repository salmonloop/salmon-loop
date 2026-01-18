import type { Context, Plan, LoopResult, StepLog, RunOptions, LoopIteration } from './types.js';
import { ContextBuilder } from './context.js';
import { LLM } from './llm.js';
import { validateDiff } from './diff.js';
import { applyPatch, rollbackFiles } from './git.js';
import { runVerify, classifyError } from './verify.js';
import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';

interface LoopOptions {
  instruction: string;
  verify: string;
  repo: string;
  llm: LLM;
  dryRun?: boolean;
  forceReset?: boolean;
}


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
        logs
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
        logs.push(this.createLog('plan', currentPlan));

        // PATCH phase
        currentDiff = await options.llm.createPatch(context, currentPlan, lastError);
        logs.push(this.createLog('patch', currentDiff));

        // VALIDATE phase
        const diffMeta = validateDiff(currentDiff);
        changedFilesThisAttempt = diffMeta.changedFiles;
        logs.push(this.createLog('validate', text.loop.diffValidationPassed));

        // APPLY phase
        if (!options.dryRun) {
          await applyPatch(options.repo, currentDiff);
          logs.push(this.createLog('apply', text.loop.patchApplied));
        } else {
          logs.push(this.createLog('apply', text.loop.dryRunPatchNotApplied));
        }

        // VERIFY phase
        const verifyResult = await runVerify(options.repo, options.verify);
        logs.push(this.createLog('verify', verifyResult.output, verifyResult.ok));

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
            logs.push(this.createLog('apply', text.loop.rollbackFailed(rb.stderr), false));
            return {
              success: false,
              reason: text.loop.rollbackFailedDirty,
              attempts: retries,
              logs,
              history,
              finalPatch: currentDiff || undefined
            };
          } else {
            const msg = options.forceReset ? text.loop.rollbackAllSuccess : text.loop.rollbackSuccess(changedFilesThisAttempt);
            logs.push(this.createLog('apply', msg));
          }
        }

        if (retries > LIMITS.maxRetries) {
          return {
            success: false,
            reason: text.loop.exceededMaxRetriesSimple,
            attempts: retries,
            logs,
            history,
            finalPatch: currentDiff || undefined
          };
        }

        // Shrink context
        const errorType = classifyError(verifyResult.output);
        const failedFiles = ContextBuilder.extractFailedFiles(verifyResult.output);
        context = await ContextBuilder.shrinkContext(context, failedFiles, errorType);

      } catch (error) {
        // Rollback on error
        if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
          const rb = await rollbackFiles(options.repo, changedFilesThisAttempt, options.forceReset);
          if (!rb.ok) {
            logs.push(this.createLog('error', text.loop.rollbackFailed(rb.stderr), false));
          } else {
            const msg = options.forceReset ? text.loop.rollbackAllSuccess : text.loop.rollbackSuccess(changedFilesThisAttempt);
            logs.push(this.createLog('apply', msg));
          }
        }

        logs.push(this.createLog('error', error instanceof Error ? error.message : String(error), false));
        
        return {
          success: false,
          reason: text.loop.loopExecutionFailed,
          attempts: retries + 1,
          logs,
          history,
          finalPatch: currentDiff || undefined
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

  private createLog(step: 'plan' | 'patch' | 'validate' | 'apply' | 'verify' | 'error', output: any, success = true): StepLog {
    return {
      step,
      success,
      output: typeof output === 'string' ? output : JSON.stringify(output),
      timestamp: new Date()
    };
  }
}
