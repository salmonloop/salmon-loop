import type { Context, Plan, LoopResult, StepLog, RunOptions } from './types.js';
import { ContextBuilder } from './context.js';
import { StubLLM } from './llm.js';
import { validateDiff } from './diff.js';
import { applyPatch, rollbackFiles } from './git.js';
import { runVerify } from './verify.js';
import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';

interface LoopOptions {
  instruction: string;
  verify: string;
  repo: string;
  llm: StubLLM;
  dryRun?: boolean;
}

export class SalmonLoop {
  async run(options: LoopOptions): Promise<LoopResult> {
    const logs: StepLog[] = [];
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

    while (retries <= LIMITS.maxRetries) {
    try {
      // PLAN phase
      currentPlan = await options.llm.createPlan(context, options.instruction);
      logs.push(this.createLog('plan', currentPlan));

      // PATCH phase
      currentDiff = await options.llm.createPatch(context, currentPlan, lastError);
      logs.push(this.createLog('patch', currentDiff));

      // VALIDATE phase
      validateDiff(currentDiff);
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
          finalPatch: currentDiff || undefined
        };
      }

      // Verification failed, preparing to retry
      lastError = verifyResult.output;
      retries++;

      if (retries > LIMITS.maxRetries) {
        return {
          success: false,
          reason: text.loop.exceededMaxRetriesSimple,
          attempts: retries,
          logs,
          finalPatch: currentDiff || undefined
        };
      }

      // Shrink context
      const failedFiles = this.extractFailedFiles(verifyResult.output);
      context = this.shrinkContext(context, failedFiles);

      // Rollback files
      if (!options.dryRun && failedFiles.length > 0) {
        await rollbackFiles(options.repo, failedFiles);
      }

    } catch (error) {
      logs.push(this.createLog('error', error instanceof Error ? error.message : String(error), false));
      
      return {
        success: false,
        reason: text.loop.loopExecutionFailed,
        attempts: retries + 1,
        logs,
        finalPatch: currentDiff || undefined
      };
    }
  }

  return {
    success: false,
    reason: text.loop.unexpectedTermination,
    attempts: retries,
    logs,
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

  private extractFailedFiles(verifyOutput: string): string[] {
    // Match relative path format (supports multi-level directories and common extensions)
    // Exclude node_modules, .git, etc.
    const pathPattern = /(?:\b[\w-]+\/)*[\w-]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h)\b/g;
    const matches = verifyOutput.match(pathPattern) || [];

    const uniqueFiles = new Set<string>();
    
    for (const file of matches) {
      if (!file.includes('node_modules') && !file.startsWith('.git')) {
        uniqueFiles.add(file);
      }
    }

    // Return empty array if no files found
    return Array.from(uniqueFiles);
  }

  private shrinkContext(context: Context, failedFiles: string[]): Context {
    // Shrink context, keeping only content related to failed files
    return {
      ...context,
      rgSnippets: context.rgSnippets.filter(snippet =>
        failedFiles.some(file => snippet.file.includes(file))
      )
    };
  }
}