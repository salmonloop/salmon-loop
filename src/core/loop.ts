import { text } from '../locales/index.js';

import { ContextBuilder } from './context.js';
import { validateDiff, normalizeDiff, validatePatchContent } from './diff.js';
import { applyPatch, rollbackFiles, getGitStatus } from './git.js';
import { LIMITS } from './limits.js';
import { LLM } from './llm.js';
import type {
  Context,
  Plan,
  LoopResult,
  StepLog,
  LoopIteration,
  LoopEvent,
  VerboseLevel,
  CheckpointStrategy,
} from './types.js';
import { ExecutionPhase, ErrorType, GitError } from './types.js';
import { runVerify, classifyError, preflight, verifyFileContent } from './verify.js';
import { AstParser, checkSyntaxErrors, validateScopeIntegrity, getTopLevelNodes, getNodeName, validateNodeStructure } from './ast/index.js';
import { refineFeedback } from './feedback/index.js';
import { monitor } from './monitor.js';
import { readFile } from 'fs/promises';
import path from 'path';
import { Semaphore } from './concurrency.js';
import { WorkspaceManager } from './workspace.js';
import type { ExecutionWorkspace } from './types.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

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
  /**
   * The target file path.
   */
  file?: string;
  /**
   * The direct text selection.
   */
  selection?: string;
  /**
   * Expected content changes that must be present in the patch.
   */
  expectedChanges?: string[];
  /**
   * Expected content that must be present in specific files after patching.
   */
  expectedFileContent?: { path: string; content: string }[];
  /**
   * The name of the node (e.g., function name) that is allowed to be modified.
   */
  targetNodeName?: string;
  /**
   * The checkpoint strategy to use for execution.
   */
  strategy?: CheckpointStrategy;
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
    let workspace: ExecutionWorkspace | undefined;

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
    // Only applies to direct strategy as worktree handles isolation safely
    const isDirectStrategy = !options.strategy || options.strategy === 'direct';
    if (isDirectStrategy && options.allowDirty && options.forceReset) {
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

    // Setup workspace
    try {
      workspace = await WorkspaceManager.setup({
        instruction: options.instruction,
        verify: options.verify,
        repoPath: options.repoPath,
        file: options.file,
        selection: options.selection,
        dryRun: options.dryRun,
        verbose: options.verbose,
        strategy: options.strategy,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logs.push(this.createLog('error', msg, false));
      emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
      return {
        success: false,
        reason: text.loop.loopExecutionFailed,
        reasonCode: 'LOOP_FAILED',
        attempts: 0,
        logs,
        failurePhase: ExecutionPhase.PREFLIGHT,
        errorType: ErrorType.UNKNOWN,
      };
    }

    // Effective repository path - use workspace work path (worktree or direct)
    // All subsequent operations must use this path instead of options.repoPath
    if (!workspace) {
      const msg = 'Workspace initialization failed';
      logs.push(this.createLog('error', msg, false));
      return {
        success: false,
        reason: msg,
        reasonCode: 'LOOP_FAILED',
        attempts: 0,
        logs,
        failurePhase: ExecutionPhase.PREFLIGHT,
        errorType: ErrorType.UNKNOWN,
      };
    }
    const activeRepoPath = workspace.workPath;

    try {
      // Preflight checks
      startPhase(ExecutionPhase.PREFLIGHT);
      const pf = await preflight(workspace);
      if (!pf.ok) {
        const reason = pf.reason || text.loop.preflightFailedNotGit;

        // Special case: if allowDirty is true and error is DIRTY, we proceed
        const isDirtyError = pf.reason?.includes('uncommitted changes');
        if (options.allowDirty && isDirtyError) {
          emit({
            type: 'log',
            level: 'warn',
            message: `Ignoring dirty workspace as requested: ${reason}`,
            timestamp: now(),
          });
          endPhase(true);
        } else {
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
      } else {
        endPhase(true);
      }

      try {
        startPhase(ExecutionPhase.CONTEXT);
        context = await ContextBuilder.build({
          instruction: options.instruction,
          verify: options.verify,
          repoPath: activeRepoPath,
          file: options.file,
          selection: options.selection,
          dryRun: options.dryRun,
          verbose: options.verbose,
        });
        emit({
          type: 'log',
          level: 'debug',
          message: `Context built: ${context.rgSnippets.length} snippets, diff: ${!!context.gitDiff}`,
          timestamp: now(),
        });

        if (options.verbose === 'extended' && options.file && context.primaryText) {
          try {
            const ext = path.extname(options.file).slice(1);
            let lang = ext;
            if (ext === 'js') lang = 'javascript';
            if (ext === 'ts') lang = 'typescript';
            if (ext === 'py') lang = 'python';

            const supportedLangs = ['javascript', 'typescript', 'python'];
            if (supportedLangs.includes(lang)) {
              const tree = await AstParser.parse(context.primaryText, lang);
              try {
                const topLevelNodes = getTopLevelNodes(tree);
                const nodeNames = topLevelNodes.map((n) => getNodeName(n)).filter(Boolean);
                emit({
                  type: 'log',
                  level: 'debug',
                  message: `[AST] Initial File: ${options.file}, Top-level nodes: ${nodeNames.join(', ')}`,
                  timestamp: now(),
                });

                if (options.targetNodeName) {
                  const isAtTopLevel = topLevelNodes.some(
                    (n) => getNodeName(n) === options.targetNodeName,
                  );
                  emit({
                    type: 'log',
                    level: 'debug',
                    message: `[AST] Target node '${options.targetNodeName}' at top-level: ${isAtTopLevel}`,
                    timestamp: now(),
                  });
                }
              } finally {
                if (tree && typeof tree.delete === 'function') {
                  tree.delete();
                }
              }
            }
          } catch (e) {
            emit({
              type: 'log',
              level: 'debug',
              message: `[AST] Initial AST analysis failed: ${e instanceof Error ? e.message : String(e)}`,
              timestamp: now(),
            });
          }
        }
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
        monitor.checkMemoryUsage();
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
          emit({
            type: 'log',
            level: 'trace',
            message: text.cli.rawPatch(currentDiff),
            timestamp: now(),
          });
          logs.push(this.createLog(ExecutionPhase.PATCH, currentDiff));
          endPhase(true);

          // VALIDATE phase
          startPhase(ExecutionPhase.VALIDATE);
          const diffMeta = validateDiff(currentDiff);

          // Fuzzy context matching
          if (options.file && context.primaryText) {
            const { fuzzyContextMatch } = await import('./diff.js');
            if (!fuzzyContextMatch(currentDiff, context.primaryText)) {
              const msg = 'Patch context does not match the file content (fuzzy match failed)';
              logs.push(this.createLog(ExecutionPhase.VALIDATE, msg, false));
              throw new Error(msg);
            }
          }

          if (options.expectedChanges && options.expectedChanges.length > 0) {
            if (!validatePatchContent(currentDiff, options.expectedChanges)) {
              // Treat this as a validation failure
              const msg = text.diff.diffValidationFailed(
                'Expected content changes are missing from the patch',
              );
              logs.push(this.createLog(ExecutionPhase.VALIDATE, msg, false));
              throw new Error(msg);
            }
          }

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

            // Capture original ASTs for scope integrity check
            const originalTrees: Map<string, any> = new Map();
            if (options.targetNodeName) {
              for (const file of changedFilesThisAttempt) {
                const ext = path.extname(file).slice(1);
                let lang = ext;
                if (ext === 'js') lang = 'javascript';
                if (ext === 'ts') lang = 'typescript';
                if (ext === 'py') lang = 'python';

                const supportedLangs = ['javascript', 'typescript', 'python'];
                if (supportedLangs.includes(lang)) {
                  try {
                    const filePath = path.join(activeRepoPath, file);
                    const content = await readFile(filePath, 'utf8');
                    const tree = await AstParser.parse(content, lang);
                    originalTrees.set(file, tree);
                  } catch (e) {
                    // Ignore errors reading original file
                  }
                }
              }
            }

            await applyPatch(activeRepoPath, currentDiff);

            // AST Validation
            let astError: string | null = null;
            for (const file of changedFilesThisAttempt) {
              const ext = path.extname(file).slice(1);
              const supportedLangs = ['javascript', 'typescript', 'python', 'go', 'java', 'rust'];
              let lang = ext;
              if (ext === 'js') lang = 'javascript';
              if (ext === 'ts') lang = 'typescript';
              if (ext === 'py') lang = 'python';

              if (supportedLangs.includes(lang)) {
                try {
                  const filePath = path.join(activeRepoPath, file);
                  const content = await readFile(filePath, 'utf8');
                  const tree = await AstParser.parse(content, lang);

                  try {
                    if (options.verbose === 'extended') {
                      const topLevelNodes = getTopLevelNodes(tree);
                      const nodeNames = topLevelNodes.map((n) => getNodeName(n)).filter(Boolean);
                      emit({
                        type: 'log',
                        level: 'debug',
                        message: `[AST] File: ${file}, Top-level nodes: ${nodeNames.join(', ')}`,
                        timestamp: now(),
                      });
                    }

                    // Deep validation of AST structure (checking for ERROR nodes)
                    if (!validateNodeStructure(tree.rootNode)) {
                      astError = `AST Structure Error in ${file}: ${text.ast.invalidStructure}`;
                      emit({ type: 'log', level: 'warn', message: astError, timestamp: now() });
                      break;
                    }

                    // Scope integrity check
                    if (options.targetNodeName && originalTrees.has(file)) {
                      const originalTree = originalTrees.get(file);
                      const integrity = validateScopeIntegrity(originalTree, tree, options.targetNodeName);

                      if (options.verbose === 'extended') {
                        const topLevelNodes = getTopLevelNodes(tree);
                        const isAtTopLevel = topLevelNodes.some(
                          (n) => getNodeName(n) === options.targetNodeName,
                        );
                        emit({
                          type: 'log',
                          level: 'debug',
                          message: `[AST] Target node '${options.targetNodeName}' at top-level: ${isAtTopLevel}`,
                          timestamp: now(),
                        });
                      }

                      if (!integrity.ok) {
                        astError = `AST Scope Integrity Error in ${file}: ${integrity.reason}`;
                        emit({ type: 'log', level: 'warn', message: astError, timestamp: now() });
                        break;
                      }

                      if (options.verbose === 'extended') {
                        emit({
                          type: 'log',
                          level: 'debug',
                          message: `[AST] Scope integrity check passed for ${file}`,
                          timestamp: now(),
                        });
                      }
                    }
                  } finally {
                    if (tree && typeof tree.delete === 'function') {
                      tree.delete();
                    }
                  }
                } catch (e) {
                  const errorMsg = `AST validation failed for ${file}: ${e instanceof Error ? e.message : String(e)}`;
                  emit({
                    type: 'log',
                    level: 'warn',
                    message: errorMsg,
                    timestamp: now(),
                  });
                  // If the validator itself crashes, treat it as a syntax error to trigger retry
                  astError = errorMsg;
                  break;
                }
              }
            }

            // Cleanup original trees
            for (const tree of originalTrees.values()) {
              if (tree && typeof tree.delete === 'function') {
                tree.delete();
              }
            }

            if (astError) {
              // Treat AST error as a verification failure to trigger retry
              const verifyResult = { ok: false, output: astError, exitCode: 1 };
              logs.push(this.createLog(ExecutionPhase.VERIFY, verifyResult.output, verifyResult.ok));
              emit({
                type: 'verify.result',
                ok: verifyResult.ok,
                output: verifyResult.output,
                timestamp: now(),
              });
              endPhase(false);

              // Trigger retry logic
              lastError = refineFeedback(verifyResult.output);
              const errorType = ErrorType.COMPILATION;
              const failedFiles = ContextBuilder.extractFailedFiles(verifyResult.output);
              emit({
                type: 'retry',
                fromAttempt: attempt,
                toAttempt: attempt + 1,
                reason: lastError,
                failedFiles,
                timestamp: now(),
              });

              history.push({
                attempt,
                plan: currentPlan,
                patch: currentDiff,
                error: lastError,
                contextSummary: `Snippets: ${context.rgSnippets.length}, Diff: ${!!context.gitDiff}`,
              });

              retries++;
              if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
                startPhase(ExecutionPhase.ROLLBACK);
                const rb = await rollbackFiles(activeRepoPath, changedFilesThisAttempt, options.forceReset);
                if (!rb.ok) {
                  const status = await getGitStatus(activeRepoPath);
                  const errorMsg = status ? `${rb.stderr}\n\nGit Status:\n${status}` : rb.stderr;
                  const msg = text.loop.rollbackFailed(errorMsg);
                  logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg, false));
                  emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
                  endPhase(false);
                  return {
                    success: false,
                    reason: text.loop.rollbackFailedDirty,
                    reasonCode: 'ROLLBACK_FAILED',
                    attempts: attempt,
                    logs,
                    history,
                    finalPatch: currentDiff || undefined,
                    failurePhase: ExecutionPhase.ROLLBACK,
                    errorType: ErrorType.COMPILATION,
                  };
                } else {
                  const msg = options.forceReset
                    ? text.loop.rollbackAllSuccess
                    : text.loop.rollbackSuccess(changedFilesThisAttempt);
                  logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg));
                  emit({ type: 'log', level: 'info', message: msg, timestamp: now() });
                  endPhase(true);
                }
              }
              continue;
            }

            logs.push(this.createLog(ExecutionPhase.APPLY, text.loop.patchApplied));
            endPhase(true);
          } catch (e) {
            endPhase(false);
            throw e;
          }

          // VERIFY phase
          startPhase(ExecutionPhase.VERIFY);
          const verifyResult = await runVerify(activeRepoPath, options.verify);

          // Extra Content Verification
          if (
            verifyResult.ok &&
            options.expectedFileContent &&
            options.expectedFileContent.length > 0
          ) {
            for (const check of options.expectedFileContent) {
              const hasContent = await verifyFileContent(activeRepoPath, check.path, check.content);
              if (!hasContent) {
                verifyResult.ok = false;
                verifyResult.output += `\n[Verification Error] Expected content '${check.content}' not found in file: ${check.path}`;
              }
            }
          }

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
          lastError = refineFeedback(verifyResult.output);
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
              activeRepoPath,
              changedFilesThisAttempt,
              options.forceReset,
            );
            if (!rb.ok) {
              endPhase(false);
              const status = await getGitStatus(activeRepoPath);
              const errorMsg = status ? `${rb.stderr}\n\nGit Status:\n${status}` : rb.stderr;
              const msg = text.loop.rollbackFailed(errorMsg);
              logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg, false));
              emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
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
              emit({ type: 'log', level: 'info', message: msg, timestamp: now() });
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
          // Handle unexpected errors within the loop by triggering a retry if possible
          let failurePhase: ExecutionPhase = currentPhase;
          endPhase(false);

          const errorMsg = error instanceof Error ? error.message : String(error);
          const lastFeedback = refineFeedback(errorMsg);

          // Safety: Never rollback in dryRun mode
          if (!options.dryRun && (changedFilesThisAttempt.length > 0 || options.forceReset)) {
            startPhase(ExecutionPhase.ROLLBACK);
            const rb = await rollbackFiles(activeRepoPath, changedFilesThisAttempt, options.forceReset);
            if (!rb.ok) {
              const status = await getGitStatus(activeRepoPath);
              const fullError = status ? `${rb.stderr}\n\nGit Status:\n${status}` : rb.stderr;
              const msg = text.loop.rollbackFailed(fullError);
              logs.push(this.createLog(ExecutionPhase.ROLLBACK, msg, false));
              emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
              return {
                success: false,
                reason: text.loop.rollbackFailedDirty,
                reasonCode: 'ROLLBACK_FAILED',
                attempts: attempt,
                logs,
                history,
                finalPatch: currentDiff || undefined,
                failurePhase: ExecutionPhase.ROLLBACK,
                errorType: ErrorType.UNKNOWN,
              };
            }
            endPhase(true);
          }

          if (retries < LIMITS.maxRetries) {
            lastError = lastFeedback;
            emit({
              type: 'retry',
              fromAttempt: attempt,
              toAttempt: attempt + 1,
              reason: lastError,
              failedFiles: [],
              timestamp: now(),
            });

            history.push({
              attempt,
              plan: currentPlan,
              patch: currentDiff,
              error: lastError,
              contextSummary: `Snippets: ${context.rgSnippets.length}, Diff: ${!!context.gitDiff}`,
            });

            retries++;

            // Shrink context before retry
            startPhase(ExecutionPhase.SHRINK);
            context = await ContextBuilder.shrinkContext(context, [], ErrorType.UNKNOWN);
            logs.push(this.createLog(ExecutionPhase.SHRINK, text.loop.contextShrunk));
            endPhase(true);
            continue;
          }

          let msg = errorMsg;
          if (error instanceof GitError) {
            msg = `${msg}\n💡 Suggestion: ${text.suggestions.gitError}`;
          }
          logs.push(this.createLog('error', msg, false));
          emit({ type: 'log', level: 'error', message: msg, timestamp: now() });

          return {
            success: false,
            reason: text.loop.loopExecutionFailed,
            reasonCode: 'LOOP_FAILED',
            attempts: attempt,
            logs,
            history,
            finalPatch: currentDiff || undefined,
            failurePhase,
            errorType: ErrorType.UNKNOWN,
          };
        }
      }

      // This code should never be reached because the loop should always return
      // from within the try block when retries exceed the limit
      return {
        success: false,
        reason: text.loop.exceededMaxRetriesSimple,
        reasonCode: 'MAX_RETRIES',
        attempts: retries,
        logs,
        history,
        finalPatch: currentDiff || undefined,
        errorType: ErrorType.UNKNOWN,
      };
    } finally {
      // Cleanup workspace
      if (workspace) {
        try {
          await WorkspaceManager.teardown(workspace);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          emit({ type: 'log', level: 'warn', message: `Workspace cleanup failed: ${msg}`, timestamp: now() });
        }
      }
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
