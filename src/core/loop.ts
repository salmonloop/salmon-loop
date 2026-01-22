import { text } from '../locales/index.js';

import { ContextBuilder } from './context.js';
import { validateDiff, normalizeDiff, validatePatchContent } from './diff.js';
import { applyPatch, rollbackFiles, getGitStatus } from './git.js';
import { LIMITS } from './limits.js';
import { LLM } from './llm.js';
import { logger } from './logger.js';
import type {
  Context,
  Plan,
  LoopResult,
  StepLog,
  LoopIteration,
  LoopEvent,
  VerboseLevel,
  CheckpointStrategy,
  CheckpointRef,
  ApplyBackOnDirty,
} from './types.js';
import { ExecutionPhase, ErrorType, GitError } from './types.js';
import { runVerify, runCommand, classifyError, preflight, verifyFileContent } from './verify.js';
import {
  AstParser,
  checkSyntaxErrors,
  validateScopeIntegrity,
  getTopLevelNodes,
  getNodeName,
  validateNodeStructure,
} from './ast/index.js';
import { refineFeedback } from './feedback/index.js';
import { monitor } from './monitor.js';
import { ShadowMergeEngine } from './merge/shadow-merge.js';
import { readFile, writeFile, mkdir, copyFile, stat, unlink } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { Semaphore } from './concurrency.js';
import { WorkspaceManager } from './workspace.js';
import type { ExecutionWorkspace } from './types.js';
import { runGit } from './checkpoint/worktree.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

const SECURITY_BLOCKLIST: RegExp[] = [
  /^\.git(\/|\\)/i,
  /^\.env/i,
  /id_rsa$/i,
  /\.pem$/i,
  /\.key$/i,
];

const DEFAULT_MAX_FILE_BYTES = Number(process.env.SALMON_SECURITY_MAX_FILE_BYTES) || 1024 * 1024;

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
  /**
   * Behavior when apply-back detects a dirty main workspace.
   */
  applyBackOnDirty?: ApplyBackOnDirty;
  /**
   * Optional setup command to run inside worktree before processing.
   */
  worktreePrepare?: string;
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
    let checkpointRef: CheckpointRef | undefined;
    let setupWorkPath: string | null = null;
    const shadowTaskId = randomBytes(4).toString('hex');
    let shadowInitialRef: string | null = null;
    let shadowLatestRef: string | null = null;

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
      setupWorkPath = workspace.workPath;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logs.push(this.createLog('error', msg, false));
      emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
      return {
        success: false,
        reason: text.loop.workspaceInitFailed,
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
      const msg = text.loop.workspaceInitFailed;
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

    // Capture worktree metadata if using worktree strategy
    if (options.strategy === 'worktree') {
      try {
        const baseRef = await runGit(options.repoPath, ['rev-parse', 'HEAD']);
        checkpointRef = {
          strategy: 'worktree',
          repoPath: options.repoPath,
          worktreePath: workspace.workPath,
          baseRef,
          branchName: 'workspace',
        };
        emit({
          type: 'checkpoint.created',
          worktreePath: checkpointRef.worktreePath,
          baseRef: checkpointRef.baseRef,
          timestamp: now(),
        });
      } catch (error) {
        const msg = text.loop.worktreeMetadataFailed(
          error instanceof Error ? error.message : String(error),
        );
        logs.push(this.createLog('error', msg, false));
        emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
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
        if (isDirtyError && options.strategy === 'worktree') {
          emit({
            type: 'log',
            level: 'debug',
            message: text.loop.ignoringDirtyWorkspaceDebug(reason),
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
        if (options.strategy === 'worktree' && options.worktreePrepare) {
          emit({
            type: 'log',
            level: 'debug',
            message: text.loop.worktreePrepareDebug(options.worktreePrepare),
            timestamp: now(),
          });
          const prepareResult = await runCommand(
            activeRepoPath,
            options.worktreePrepare,
            LIMITS.worktreePrepareTimeoutMs,
          );
          logs.push(
            this.createLog(ExecutionPhase.PREFLIGHT, prepareResult.output, prepareResult.ok),
          );
          if (!prepareResult.ok) {
            const msg = text.loop.worktreePrepareFailed(prepareResult.output);
            endPhase(false);
            emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
            return {
              success: false,
              reason: msg,
              reasonCode: 'LOOP_FAILED',
              attempts: 0,
              logs,
              failurePhase: ExecutionPhase.PREFLIGHT,
              errorType: ErrorType.DEPENDENCY_ERROR,
            };
          }
        }

        if (options.strategy === 'worktree' && checkpointRef) {
          const mainStatus = await getGitStatus(options.repoPath);
          if (mainStatus.trim()) {
            emit({
              type: 'log',
              level: 'debug',
              message: text.loop.syncingDirtyWorkspace,
              timestamp: now(),
            });
            try {
              const snapshot = await this.captureDirtySnapshot(options.repoPath);
              await this.applyDirtySnapshotToWorktree(
                options.repoPath,
                activeRepoPath,
                snapshot,
                options.verbose,
              );
              const baselineRef = await this.createDirtyBaselineCommit(
                activeRepoPath,
                shadowTaskId,
              );
              if (baselineRef) {
                checkpointRef.baseRef = baselineRef;
                shadowInitialRef = baselineRef;
                emit({
                  type: 'log',
                  level: 'debug',
                  message: `Dirty baseline commit created in worktree: ${baselineRef}`,
                  timestamp: now(),
                });
              } else {
                shadowInitialRef = checkpointRef.baseRef;
                await runGit(activeRepoPath, [
                  'update-ref',
                  `refs/ai-agent/checkpoints/${shadowTaskId}/initial`,
                  checkpointRef.baseRef,
                ]);
              }
            } catch (error) {
              const msg = `Failed to sync dirty workspace into worktree: ${
                error instanceof Error ? error.message : String(error)
              }`;
              endPhase(false);
              emit({ type: 'log', level: 'error', message: msg, timestamp: now() });
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
          } else {
            shadowInitialRef = checkpointRef.baseRef;
            try {
              await runGit(activeRepoPath, [
                'update-ref',
                `refs/ai-agent/checkpoints/${shadowTaskId}/initial`,
                checkpointRef.baseRef,
              ]);
            } catch (error) {
              emit({
                type: 'log',
                level: 'warn',
                message: `Failed to record initial checkpoint ref: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: now(),
              });
            }
          }
        }
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
          const warnMsg = text.loop.noContextGathered;
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

          // CRITICAL: Normalize BEFORE validation to ensure paths are cleaned
          // This prevents validateDiff from treating invalid paths like 'a/test-repo/index.js' as valid
          currentDiff = normalizeDiff(currentDiff);

          const diffMeta = validateDiff(currentDiff);

          // Removed fuzzy context matching - rely on semantic anchor (3-way merge) instead
          // Fuzzy matching with arbitrary thresholds is unreliable and can mask real conflicts

          if (options.expectedChanges && options.expectedChanges.length > 0) {
            if (!validatePatchContent(currentDiff, options.expectedChanges)) {
              // Treat this as a validation failure
              const msg = 'Diff validation failed: Expected content changes are missing from the patch';
              logs.push(this.createLog(ExecutionPhase.VALIDATE, msg, false));
              throw new Error(msg);
            }
          }
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

            const strictTargetApply = Boolean(options.targetNodeName);
            await applyPatch(activeRepoPath, currentDiff, {
              contextLines: 3,
              ignoreWhitespace: strictTargetApply ? false : true,
              threeWay: strictTargetApply,
            });

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
                      astError = text.loop.astStructureError(file, text.ast.invalidStructure);
                      emit({ type: 'log', level: 'warn', message: astError, timestamp: now() });
                      break;
                    }

                    // Scope integrity check
                    if (options.targetNodeName && originalTrees.has(file)) {
                      const originalTree = originalTrees.get(file);
                      const integrity = validateScopeIntegrity(
                        originalTree,
                        tree,
                        options.targetNodeName,
                      );

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
                        astError = text.loop.astScopeIntegrityError(file, integrity.reason || '');
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
                      const placement = await this.validateTargetNodeDiff(
                        activeRepoPath,
                        file,
                        tree,
                        options.targetNodeName,
                        options.verbose,
                      );
                      if (!placement.ok) {
                        astError = text.loop.targetNodePlacementError(file, placement.reason || '');
                        emit({ type: 'log', level: 'warn', message: astError, timestamp: now() });
                        break;
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
              logs.push(
                this.createLog(ExecutionPhase.VERIFY, verifyResult.output, verifyResult.ok),
              );
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
                emit({
                  type: 'log',
                  level: 'trace',
                  message: `[ROLLBACK] Using shadowInitialRef: ${shadowInitialRef}`,
                  timestamp: now(),
                });
                const rb = await rollbackFiles(
                  activeRepoPath,
                  changedFilesThisAttempt,
                  true,
                  shadowInitialRef || undefined,
                );
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
            // Apply back to main workspace if using worktree strategy
            if (checkpointRef && options.strategy === 'worktree') {
              try {
                const finalRef =
                  (await this.createCheckpointCommit(
                    activeRepoPath,
                    shadowTaskId,
                    `final-${attempt}`,
                  )) || checkpointRef.baseRef;
                shadowLatestRef = finalRef;
                await this.applyBackToMainWorkspace(
                  options.repoPath,
                  checkpointRef,
                  currentDiff || '',
                  options.applyBackOnDirty ?? 'stash',
                  options.verbose,
                  changedFilesThisAttempt,
                  shadowInitialRef,
                  shadowLatestRef,
                );
              } catch (error) {
                const msg = `Failed to apply changes back to main workspace: ${error instanceof Error ? error.message : String(error)}`;
                logs.push(this.createLog('error', msg, false));
                emit({ type: 'log', level: 'error', message: msg, timestamp: now() });

                // Rollback main workspace changes on apply-back failure
                emit({
                  type: 'log',
                  level: 'warn',
                  message: 'Attempting to rollback main workspace changes...',
                  timestamp: now(),
                });
                try {
                  const mainStatus = await getGitStatus(options.repoPath);
                  if (mainStatus.trim()) {
                    const rb = await rollbackFiles(
                      options.repoPath,
                      changedFilesThisAttempt,
                      false,
                    );
                    if (rb.ok) {
                      emit({
                        type: 'log',
                        level: 'info',
                        message: 'Main workspace rollback succeeded',
                        timestamp: now(),
                      });
                    } else {
                      emit({
                        type: 'log',
                        level: 'error',
                        message: `Main workspace rollback failed: ${rb.stderr}`,
                        timestamp: now(),
                      });
                    }
                  }
                } catch (rollbackError) {
                  emit({
                    type: 'log',
                    level: 'error',
                    message: `Main workspace rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
                    timestamp: now(),
                  });
                }

                return {
                  success: false,
                  reason: msg,
                  reasonCode: 'APPLY_BACK_FAILED',
                  attempts: attempt,
                  logs,
                  history,
                  finalPatch: currentDiff || undefined,
                  changedFiles: changedFilesThisAttempt,
                  failurePhase: ExecutionPhase.VERIFY,
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
            emit({
              type: 'log',
              level: 'trace',
              message: `[ROLLBACK] Using shadowInitialRef: ${shadowInitialRef}`,
              timestamp: now(),
            });
            const rb = await rollbackFiles(
              activeRepoPath,
              changedFilesThisAttempt,
              options.forceReset,
              shadowInitialRef || undefined,
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
            emit({
              type: 'log',
              level: 'trace',
              message: `[ROLLBACK] Using shadowInitialRef: ${shadowInitialRef}`,
              timestamp: now(),
            });
            const rb = await rollbackFiles(
              activeRepoPath,
              changedFilesThisAttempt,
              true,
              shadowInitialRef || undefined,
            );
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
      // Cleanup workspace and checkpoint
      let checkpointCleanupOk = true;
      if (workspace) {
        if (
          workspace.strategy === 'worktree' &&
          setupWorkPath &&
          setupWorkPath !== workspace.workPath
        ) {
          try {
            await WorkspaceManager.teardown({
              baseRepoPath: workspace.baseRepoPath,
              workPath: setupWorkPath,
              strategy: 'worktree',
            });
          } catch (error) {
            checkpointCleanupOk = false;
            const msg = error instanceof Error ? error.message : String(error);
            emit({
              type: 'log',
              level: 'warn',
              message: `Extra worktree cleanup failed: ${msg}`,
              timestamp: now(),
            });
          }
        }
        try {
          await WorkspaceManager.teardown(workspace);
        } catch (error) {
          checkpointCleanupOk = false;
          const msg = error instanceof Error ? error.message : String(error);
          emit({
            type: 'log',
            level: 'warn',
            message: `Workspace cleanup failed: ${msg}`,
            timestamp: now(),
          });
        }
      }

      if (checkpointRef) {
        emit({
          type: 'checkpoint.cleaned',
          ok: checkpointCleanupOk,
          timestamp: now(),
        });
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

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  private isBlockedPath(relativePath: string): boolean {
    const normalized = this.normalizePath(relativePath);
    return SECURITY_BLOCKLIST.some((pattern) => pattern.test(normalized));
  }

  private async shouldAllowPath(
    repoPath: string,
    relativePath: string,
    options?: { allowMissing?: boolean; contentSize?: number },
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (this.isBlockedPath(relativePath)) {
      return { allowed: false, reason: 'blocked-path' };
    }
    try {
      const filePath = path.join(repoPath, ...relativePath.split('/'));
      const fileStat = await stat(filePath);
      if (fileStat.size > DEFAULT_MAX_FILE_BYTES) {
        return { allowed: false, reason: 'size-limit' };
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        if (options?.allowMissing === false) {
          return { allowed: false, reason: 'missing' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'stat-failed' };
    }
    return { allowed: true };
  }

  private async getChangedPaths(repoPath: string): Promise<string[]> {
    const status = await runGit(repoPath, ['status', '--porcelain', '-z']);
    if (!status) return [];
    const tokens = status.split('\0').filter((token) => token.length > 0);
    const paths: string[] = [];
    const extractPath = (entry: string): string => {
      const maybeSep = entry[2];
      if (maybeSep === ' ' || maybeSep === '\t') {
        return entry.slice(3);
      }
      return entry.slice(2);
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const entry = tokens[i];
      const code = entry.slice(0, 2);
      const pathPart = extractPath(entry);
      if (!pathPart) continue;
      if (code.startsWith('R') || code.startsWith('C')) {
        const original = pathPart;
        const renamed = tokens[i + 1];
        if (original) paths.push(original);
        if (renamed) paths.push(renamed);
        i += 1;
        continue;
      }
      paths.push(pathPart);
    }

    const unique = Array.from(new Set(paths.map((p) => this.normalizePath(p))));
    const allowed: string[] = [];
    for (const file of unique) {
      const policy = await this.shouldAllowPath(repoPath, file);
      if (!policy.allowed) {
        logger.warn(text.loop.skipPathDueToPolicy(policy.reason, file));
        continue;
      }
      allowed.push(file);
    }
    return allowed;
  }

  private parseUnifiedDiffHunks(diffText: string): { newStart: number; newLines: number }[] {
    const hunks: { newStart: number; newLines: number }[] = [];
    const lines = diffText.split(/\r?\n/);
    const regex = /^@@\s+\-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/;
    for (const line of lines) {
      const match = line.match(regex);
      if (!match) continue;
      const start = Number(match[1]);
      const count = match[2] ? Number(match[2]) : 1;
      hunks.push({ newStart: start, newLines: count });
    }
    return hunks;
  }

  private async validateTargetNodeDiff(
    repoPath: string,
    file: string,
    tree: any,
    targetNodeName: string,
    verbose?: VerboseLevel,
  ): Promise<{ ok: boolean; reason?: string }> {
    const topLevelNodes = getTopLevelNodes(tree);
    const targetNode = topLevelNodes.find((node) => getNodeName(node) === targetNodeName);
    if (!targetNode) {
      return { ok: false, reason: `Target node '${targetNodeName}' not found` };
    }
    const startLine = targetNode.startPosition.row + 1;
    const endLine = targetNode.endPosition.row + 1;

    const diffText = await runGit(repoPath, [
      'diff',
      '-U0',
      '--no-color',
      '--no-ext-diff',
      '--',
      file,
    ]);
    if (!diffText.trim()) {
      return { ok: true };
    }
    const hunks = this.parseUnifiedDiffHunks(diffText);
    if (verbose === 'extended') {
      logger.trace(
        `[AST] Target node '${targetNodeName}' spans lines ${startLine}-${endLine} for ${file}`,
      );
      logger.trace(
        `[AST] Diff hunks for ${file}: ${
          hunks.map((hunk) => `+${hunk.newStart},${hunk.newLines}`).join(' | ') || 'none'
        }`,
      );
    }
    for (const hunk of hunks) {
      const hunkStart = hunk.newStart;
      const hunkEnd = hunk.newLines > 0 ? hunk.newStart + hunk.newLines - 1 : hunk.newStart;
      if (hunkEnd < startLine || hunkStart > endLine) {
        return {
          ok: false,
          reason: `Diff hunk +${hunk.newStart},${hunk.newLines} outside target range ${startLine}-${endLine}`,
        };
      }
    }
    return { ok: true };
  }

  private async createCheckpointCommit(
    worktreePath: string,
    taskId: string,
    stepId: string,
  ): Promise<string | null> {
    const changedPaths = await this.getChangedPaths(worktreePath);
    if (changedPaths.length === 0) {
      return null;
    }
    await runGit(worktreePath, ['add', '--', ...changedPaths]);
    await runGit(worktreePath, [
      '-c',
      'user.name=salmonloop',
      '-c',
      'user.email=salmonloop@local',
      'commit',
      '--no-verify',
      '--no-gpg-sign',
      '-m',
      `checkpoint: ${stepId}`,
    ]);
    const head = await runGit(worktreePath, ['rev-parse', 'HEAD']);
    await runGit(worktreePath, [
      'update-ref',
      `refs/ai-agent/checkpoints/${taskId}/${stepId}`,
      head,
    ]);
    return head;
  }

  private async applyBackWithDualMerge(
    mainRepoPath: string,
    shadowWorktreePath: string,
    initialRef: string,
    latestRef: string,
    verbose?: VerboseLevel,
  ): Promise<void> {
    const engine = new ShadowMergeEngine({
      mainRepoPath,
      shadowWorktreePath,
      initialRef,
      latestRef,
      verbose,
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      shouldAllowPath: (filePath, contentSize) =>
        this.shouldAllowPath(mainRepoPath, filePath, { contentSize }),
    });
    await engine.apply();
  }

  private async captureDirtySnapshot(repoPath: string): Promise<{
    stagedPatch: string;
    unstagedPatch: string;
    untrackedFiles: string[];
    trackedFiles: string[];
    deletedFiles: string[];
    stagedFiles: string[];
    unstagedFiles: string[];
  }> {
    const status = await runGit(repoPath, ['status', '--porcelain']);
    logger.trace(`[captureDirtySnapshot] git status output:\n${status}`);

    const entries = this.parseStatusEntries(status);
    const trackedFilesRaw = entries
      .filter((entry) => entry.code !== '??')
      .map((entry) => entry.path);
    const deletedFiles = new Set<string>(
      entries.filter((entry) => entry.origPath).map((entry) => entry.origPath as string),
    );

    const trackedFiles: string[] = [];
    for (const file of trackedFilesRaw) {
      try {
        await readFile(path.join(repoPath, ...file.split('/')));
        trackedFiles.push(file);
      } catch {
        deletedFiles.add(file);
      }
    }
    const stagedPatch = await runGit(repoPath, [
      'diff',
      '--cached',
      '--binary',
      '--no-color',
      '--no-ext-diff',
    ]);
    const unstagedPatch = await runGit(repoPath, [
      'diff',
      '--binary',
      '--no-color',
      '--no-ext-diff',
    ]);
    const stagedFilesOutput = await runGit(repoPath, ['diff', '--name-only', '--cached']);
    const unstagedFilesOutput = await runGit(repoPath, ['diff', '--name-only']);

    logger.trace(`[captureDirtySnapshot] Staged files output: "${stagedFilesOutput}"`);
    logger.trace(`[captureDirtySnapshot] Unstaged files output: "${unstagedFilesOutput}"`);
    logger.trace(`[captureDirtySnapshot] Staged patch length: ${stagedPatch.length} bytes`);
    logger.trace(`[captureDirtySnapshot] Unstaged patch length: ${unstagedPatch.length} bytes`);
    const parseList = (output: string): string[] =>
      output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => this.normalizePath(line));
    const stagedFiles = parseList(stagedFilesOutput);
    const unstagedFiles = parseList(unstagedFilesOutput);
    const untrackedOutput = await runGit(repoPath, ['ls-files', '--others', '--exclude-standard']);
    const untrackedFiles = untrackedOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return {
      stagedPatch,
      unstagedPatch,
      untrackedFiles,
      trackedFiles,
      deletedFiles: Array.from(deletedFiles),
      stagedFiles,
      unstagedFiles,
    };
  }

  private parseStatusEntries(status: string): {
    code: string;
    path: string;
    origPath?: string;
  }[] {
    if (!status) return [];
    return status
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const code = line.slice(0, 2).trim() || line.slice(0, 2);
        const rawPath = line.length > 2 ? line.slice(2).trimStart() : '';
        if (rawPath.includes('->')) {
          const [orig, dest] = rawPath.split('->').map((value) => value.trim());
          return { code, path: dest, origPath: orig };
        }
        return { code, path: rawPath };
      })
      .filter((entry) => entry.path.length > 0);
  }

  private async applyDirtySnapshotToWorktree(
    sourceRepoPath: string,
    worktreePath: string,
    snapshot: {
      stagedPatch: string;
      unstagedPatch: string;
      untrackedFiles: string[];
      trackedFiles: string[];
      deletedFiles: string[];
      stagedFiles: string[];
      unstagedFiles: string[];
    },
    verbose?: VerboseLevel,
  ): Promise<void> {
    // Goal: Copy the complete working tree state from main workspace to worktree
    // This includes staged changes + unstaged changes + untracked files
    // The worktree working tree should match exactly what the user sees in main workspace

    // Step 1: Copy all tracked files (working tree version with all modifications)
    if (snapshot.trackedFiles.length > 0) {
      if (verbose === 'extended') {
        logger.trace(
          `[applyDirtySnapshot] Copying ${snapshot.trackedFiles.length} tracked files from main working tree to worktree`,
        );
      }
      await this.copyTrackedFilesWithLineEndingLogging(
        sourceRepoPath,
        worktreePath,
        snapshot.trackedFiles,
        verbose,
      );
    }

    // Step 2: Handle deleted files
    if (snapshot.deletedFiles.length > 0) {
      if (verbose === 'extended') {
        logger.trace(
          `[applyDirtySnapshot] Removing ${snapshot.deletedFiles.length} deleted files in worktree`,
        );
      }
      for (const file of snapshot.deletedFiles) {
        try {
          await runGit(worktreePath, ['rm', '-f', '--', file]);
        } catch {
          // Ignore remove failures; file may already be absent
        }
      }
    }

    // Step 3: Copy untracked files
    if (snapshot.untrackedFiles.length > 0) {
      if (verbose === 'extended') {
        logger.trace(
          `[applyDirtySnapshot] Copying ${snapshot.untrackedFiles.length} untracked files from main to worktree`,
        );
      }
      await this.copyUntrackedFiles(sourceRepoPath, worktreePath, snapshot.untrackedFiles, verbose);
    }

    // Note: We do NOT apply staged patch or sync index to working tree
    // Because our goal is: worktree working tree = main workspace working tree (complete state)
    // The subsequent createDirtyBaselineCommit will commit the working tree content as-is
    // This ensures Context builder sees exactly what will be committed as baseline
  }

  private async copyUntrackedFiles(
    sourceRepoPath: string,
    targetRepoPath: string,
    files: string[],
    verbose?: VerboseLevel,
  ): Promise<void> {
    for (const file of files) {
      const policy = await this.shouldAllowPath(sourceRepoPath, file);
      if (!policy.allowed) {
        logger.warn(text.loop.skipFileDueToPolicy(policy.reason, file));
        continue;
      }
      const srcPath = path.join(sourceRepoPath, ...file.split('/'));
      const destPath = path.join(targetRepoPath, ...file.split('/'));
      await mkdir(path.dirname(destPath), { recursive: true });
      try {
        await copyFile(srcPath, destPath);

        if (verbose === 'extended') {
          try {
            const srcContent = await readFile(srcPath, 'utf8');
            const destContent = await readFile(destPath, 'utf8');

            const srcCrlf = (srcContent.match(/\r\n/g) || []).length;
            const srcLf = (srcContent.match(/(^|[^\r])\n/g) || []).length;
            const destCrlf = (destContent.match(/\r\n/g) || []).length;
            const destLf = (destContent.match(/(^|[^\r])\n/g) || []).length;

            logger.trace(
              `[applyBack] Copied untracked file ${file}:\n` +
                `  Source: CRLF=${srcCrlf}, LF=${srcLf}\n` +
                `  Dest:   CRLF=${destCrlf}, LF=${destLf}`,
            );
          } catch {
            // Ignore errors in logging (e.g., binary files)
          }
        }
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === 'ENOENT') {
          logger.warn(text.loop.skipMissingFileSync(file));
          continue;
        }
        throw error;
      }
    }
  }

  private async copyTrackedFilesWithLineEndingLogging(
    sourceRepoPath: string,
    targetRepoPath: string,
    files: string[],
    verbose?: VerboseLevel,
  ): Promise<void> {
    for (const file of files) {
      const policy = await this.shouldAllowPath(sourceRepoPath, file);
      if (!policy.allowed) {
        logger.warn(text.loop.skipFileDueToPolicy(policy.reason, file));
        continue;
      }
      const srcPath = path.join(sourceRepoPath, ...file.split('/'));
      const destPath = path.join(targetRepoPath, ...file.split('/'));
      await mkdir(path.dirname(destPath), { recursive: true });
      try {
        await copyFile(srcPath, destPath);

        if (verbose === 'extended') {
          try {
            const srcContent = await readFile(srcPath, 'utf8');
            const destContent = await readFile(destPath, 'utf8');

            // Count actual line numbers (split by any newline)
            const srcLines = srcContent.split(/\r?\n/).length;
            const destLines = destContent.split(/\r?\n/).length;

            // Count line ending types
            const srcCrlf = (srcContent.match(/\r\n/g) || []).length;
            const srcLf = (srcContent.match(/(?<!\r)\n/g) || []).length;
            const destCrlf = (destContent.match(/\r\n/g) || []).length;
            const destLf = (destContent.match(/(?<!\r)\n/g) || []).length;

            // File size verification
            const srcSize = srcContent.length;
            const destSize = destContent.length;
            const sizeMatch = srcSize === destSize ? '✓' : '✗ MISMATCH';

            logger.trace(
              `[applyBack] Copied tracked file ${file}:\n` +
                `  Source path: ${srcPath}\n` +
                `  Dest path:   ${destPath}\n` +
                `  Source: ${srcLines} lines, ${srcSize} bytes (CRLF=${srcCrlf}, LF=${srcLf})\n` +
                `  Dest:   ${destLines} lines, ${destSize} bytes (CRLF=${destCrlf}, LF=${destLf})\n` +
                `  Size match: ${sizeMatch}`,
            );
          } catch (e) {
            logger.trace(
              `[applyBack] Could not log line endings for ${file}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === 'ENOENT') {
          logger.warn(text.loop.skipMissingFileSync(file));
          continue;
        }
        throw error;
      }
    }
  }

  private async fileExists(repoPath: string, relativePath: string): Promise<boolean> {
    try {
      const filePath = path.join(repoPath, ...relativePath.split('/'));
      await stat(filePath);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') return false;
      throw error;
    }
  }

  private async createDirtyBaselineCommit(
    worktreePath: string,
    taskId: string,
  ): Promise<string | null> {
    const status = await runGit(worktreePath, ['status', '--porcelain']);
    if (!status.trim()) return null;
    const changedPaths = await this.getChangedPaths(worktreePath);
    if (changedPaths.length === 0) return null;

    // Goal: Commit the complete working tree state that was copied from main workspace
    // Do NOT sync index to working tree - we want to preserve the working tree as-is
    // The working tree already contains the complete state (staged + unstaged changes)

    const existingPaths: string[] = [];
    const deletedPaths: string[] = [];
    for (const file of changedPaths) {
      if (await this.fileExists(worktreePath, file)) {
        existingPaths.push(file);
      } else {
        deletedPaths.push(file);
      }
    }
    if (existingPaths.length > 0) {
      await runGit(worktreePath, ['add', '--', ...existingPaths]);
    }
    if (deletedPaths.length > 0) {
      await runGit(worktreePath, ['add', '-u', '--', ...deletedPaths]);
    }
    await runGit(worktreePath, [
      '-c',
      'user.name=salmonloop',
      '-c',
      'user.email=salmonloop@local',
      'commit',
      '--no-verify',
      '--no-gpg-sign',
      '-m',
      'checkpoint: initial',
    ]);
    const head = await runGit(worktreePath, ['rev-parse', 'HEAD']);
    await runGit(worktreePath, ['update-ref', `refs/ai-agent/checkpoints/${taskId}/initial`, head]);
    return head;
  }

  private async applyBackToMainWorkspace(
    mainRepoPath: string,
    checkpointRef: CheckpointRef,
    diffText: string,
    applyBackOnDirty: ApplyBackOnDirty = 'stash',
    verbose?: VerboseLevel,
    changedFiles?: string[],
    shadowInitialRef?: string | null,
    shadowLatestRef?: string | null,
  ): Promise<void> {
    const startTime = Date.now();
    let applySuccess = false;
    let applyError: Error | undefined;
    let stashRef: string | null = null;
    let patchApplied = false;
    let dirtyBackup: {
      dir: string;
      stagedPatchPath?: string;
      unstagedPatchPath?: string;
      untrackedDir?: string;
      untrackedFiles: string[];
      trackedDir?: string;
      trackedFiles: string[];
      deletedFiles: string[];
    } | null = null;

    try {
      if (shadowInitialRef && shadowLatestRef) {
        const status = await getGitStatus(mainRepoPath);
        const isDirty = status.trim().length > 0;
        if (isDirty && applyBackOnDirty === 'abort') {
          throw new Error(
            `Apply-back aborted: main workspace has uncommitted changes.\n${status.trim()}`,
          );
        }
        logger.debug(
          `[applyBack] Using dual-merge apply-back (shadow refs: ${shadowInitialRef} -> ${shadowLatestRef}).`,
        );
        await this.applyBackWithDualMerge(
          mainRepoPath,
          checkpointRef.worktreePath,
          shadowInitialRef,
          shadowLatestRef,
          verbose,
        );
        applySuccess = true;
        return;
      }

      // Stage changes in worktree so new files are included in the diff
      await runGit(checkpointRef.worktreePath, ['add', '-A']);
      // Generate patch from staged worktree changes (include binary)
      const rawPatch = await runGit(checkpointRef.worktreePath, [
        'diff',
        '--cached',
        '--binary',
        '--no-color',
        '--no-ext-diff',
        checkpointRef.baseRef,
      ]);
      if (!rawPatch.trim()) {
        applySuccess = true;
        return;
      }
      const patch = rawPatch.endsWith('\n') ? rawPatch : `${rawPatch}\n`;

      if (verbose === 'extended') {
        const patchLines = patch.split(/\r?\n/);
        const previewLimit = 80;
        const preview = patchLines.slice(0, previewLimit).join('\n');
        const truncated = patchLines.length > previewLimit;
        const binaryNotice = patch.includes('GIT binary patch') ? 'yes' : 'no';
        const endsWithNewline = rawPatch.endsWith('\n');
        logger.trace(
          `[applyBack] Patch stats: ${patch.length} chars, ${patchLines.length} lines, binary: ${binaryNotice}`,
        );
        logger.trace(`[applyBack] Patch ends with newline: ${endsWithNewline}`);
        logger.trace(
          `[applyBack] Patch preview (first ${Math.min(previewLimit, patchLines.length)} lines):\n${preview}${truncated ? '\n...[truncated]...' : ''}`,
        );
        try {
          const debugPath = path.join(
            tmpdir(),
            `salmon-loop-applyback-${Date.now()}-${randomBytes(4).toString('hex')}.patch`,
          );
          await writeFile(debugPath, patch, 'utf8');
          logger.trace(`[applyBack] Patch written to: ${debugPath}`);
        } catch (error) {
          logger.warn(
            `[applyBack] Failed to write debug patch file: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const hashContent = (value: string | Buffer): string =>
        createHash('sha256').update(value).digest('hex');

      const normalizeFilePath = (value: string): string => value.replace(/\\/g, '/');

      const computeFingerprint = async (): Promise<{
        head: string;
        index: string;
        working: string;
        untracked: string;
      }> => {
        const head = await runGit(mainRepoPath, ['rev-parse', 'HEAD']);
        const index = await runGit(mainRepoPath, ['write-tree']);
        const workingDiff = await runGit(mainRepoPath, [
          'diff',
          '--binary',
          '--no-color',
          '--no-ext-diff',
        ]);
        const working = hashContent(workingDiff);
        const untrackedOutput = await runGit(mainRepoPath, [
          'ls-files',
          '--others',
          '--exclude-standard',
        ]);
        const untrackedFiles = untrackedOutput
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .sort();
        let untracked = '';
        if (untrackedFiles.length > 0) {
          const entries: string[] = [];
          for (const file of untrackedFiles) {
            try {
              const content = await readFile(path.join(mainRepoPath, ...file.split('/')));
              entries.push(`${file}:${hashContent(content)}`);
            } catch {
              entries.push(`${file}:missing`);
            }
          }
          untracked = hashContent(entries.join('\n'));
        } else {
          untracked = hashContent('');
        }
        return { head, index, working, untracked };
      };

      const fingerprintEquals = (
        a: { head: string; index: string; working: string; untracked: string },
        b: { head: string; index: string; working: string; untracked: string },
      ): boolean =>
        a.head === b.head &&
        a.index === b.index &&
        a.working === b.working &&
        a.untracked === b.untracked;

      const formatFingerprintDiff = (
        a: { head: string; index: string; working: string; untracked: string },
        b: { head: string; index: string; working: string; untracked: string },
      ): string => {
        const diffs: string[] = [];
        if (a.head !== b.head) diffs.push('HEAD');
        if (a.index !== b.index) diffs.push('INDEX');
        if (a.working !== b.working) diffs.push('WORKING');
        if (a.untracked !== b.untracked) diffs.push('UNTRACKED');
        return diffs.length > 0
          ? `Fingerprint changed: ${diffs.join(', ')}`
          : 'Fingerprint unchanged';
      };

      const getStatus = async (): Promise<string> => {
        const status = await getGitStatus(mainRepoPath);
        return status.trim();
      };

      const parseStatusFiles = (status: string): string[] => {
        if (!status) return [];
        return status
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const raw = line.length > 3 ? line.slice(3).trim() : '';
            if (!raw) return raw;
            if (raw.includes('->')) {
              return raw.split('->').pop()?.trim() || raw;
            }
            return raw;
          })
          .filter(Boolean);
      };

      const initialStatus = await getStatus();
      const wasDirty = initialStatus.length > 0;
      const statusEntries = this.parseStatusEntries(initialStatus);
      const dirtyFiles = statusEntries
        .filter((entry) => entry.code !== '??')
        .map((entry) => normalizeFilePath(entry.path));
      const dirtyDeletedFiles = statusEntries
        .filter((entry) => entry.origPath)
        .map((entry) => normalizeFilePath(entry.origPath as string));
      const originalFingerprint = await computeFingerprint();

      if (wasDirty && applyBackOnDirty === 'abort') {
        throw new Error(
          `Apply-back aborted: main workspace has uncommitted changes.\n${initialStatus}`,
        );
      }

      // Create backup before applying (stash mode)
      const getStashHead = async (): Promise<string | null> => {
        try {
          const head = await runGit(mainRepoPath, ['rev-parse', '-q', '--verify', 'refs/stash']);
          return head || null;
        } catch {
          return null;
        }
      };

      const resolveStashRef = async (stashHash: string): Promise<string> => {
        try {
          const list = await runGit(mainRepoPath, ['stash', 'list', '--format=%H %gd']);
          const match = list
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.startsWith(stashHash));
          if (!match) return stashHash;
          const parts = match.split(' ');
          return parts[1] || stashHash;
        } catch {
          return stashHash;
        }
      };

      const restoreStash = async (ref: string): Promise<void> => {
        try {
          await runGit(mainRepoPath, ['stash', 'apply', '--index', ref]);
        } catch (error) {
          throw new Error(
            `Failed to reapply stash backup (${ref}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        try {
          await runGit(mainRepoPath, ['stash', 'drop', ref]);
        } catch (dropError) {
          logger.warn(
            `Failed to drop stash backup (${ref}): ${dropError instanceof Error ? dropError.message : String(dropError)}`,
          );
        }
      };

      const resolveChangedFiles = (): string[] => {
        if (changedFiles && changedFiles.length > 0) return changedFiles;
        try {
          const meta = validateDiff(normalizeDiff(patch));
          return meta.changedFiles;
        } catch {
          return [];
        }
      };

      const filesToApply = resolveChangedFiles().map(normalizeFilePath);
      const hasOverlap = filesToApply.some((file) => dirtyFiles.includes(file));
      const allowDirtyApply = wasDirty && applyBackOnDirty === 'stash' && hasOverlap;
      let preparedFingerprint = originalFingerprint;

      const assertFingerprintUnchanged = async (
        expected: typeof originalFingerprint,
        stage: string,
      ) => {
        const current = await computeFingerprint();
        if (!fingerprintEquals(expected, current)) {
          const status = await getStatus();
          const diff = formatFingerprintDiff(expected, current);
          const statusBlock = status ? `\nGit status:\n${status}` : '';
          throw new Error(
            `Apply-back aborted: main workspace changed after ${stage}.\n${diff}${statusBlock}`,
          );
        }
      };

      const mainHead = await runGit(mainRepoPath, ['rev-parse', 'HEAD']);
      const preserveIndexLines = checkpointRef.baseRef.trim() === mainHead.trim();
      const applyBackPatchOptions = {
        preserveIndexLines,
        ignoreWhitespace: false,
        contextLines: 3,
        threeWay: true,
      };
      if (!preserveIndexLines) {
        logger.warn(
          `[applyBack] Patch base (${checkpointRef.baseRef}) differs from main HEAD (${mainHead}); dropping index lines to avoid mismatch.`,
        );
      }

      if (allowDirtyApply) {
        const ensureTrailingNewline = (content: string): string =>
          content.endsWith('\n') ? content : `${content}\n`;

        const createDirtyBackup = async () => {
          const backupDir = path.join(
            tmpdir(),
            `salmon-loop-backup-${Date.now()}-${randomBytes(4).toString('hex')}`,
          );
          await mkdir(backupDir, { recursive: true });

          const stagedPatch = await runGit(mainRepoPath, [
            'diff',
            '--cached',
            '--binary',
            '--no-color',
            '--no-ext-diff',
          ]);
          let stagedPatchPath: string | undefined;
          if (stagedPatch.trim()) {
            stagedPatchPath = path.join(backupDir, 'staged.patch');
            await writeFile(stagedPatchPath, ensureTrailingNewline(stagedPatch), 'utf8');
          }

          const unstagedPatch = await runGit(mainRepoPath, [
            'diff',
            '--binary',
            '--no-color',
            '--no-ext-diff',
          ]);
          let unstagedPatchPath: string | undefined;
          if (unstagedPatch.trim()) {
            unstagedPatchPath = path.join(backupDir, 'unstaged.patch');
            await writeFile(unstagedPatchPath, ensureTrailingNewline(unstagedPatch), 'utf8');
          }

          const untrackedOutput = await runGit(mainRepoPath, [
            'ls-files',
            '--others',
            '--exclude-standard',
          ]);
          const untrackedFiles = untrackedOutput
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          let untrackedDir: string | undefined;
          let trackedDir: string | undefined;
          const deletedFiles = new Set<string>(dirtyDeletedFiles);

          if (untrackedFiles.length > 0) {
            untrackedDir = path.join(backupDir, 'untracked');
            for (const file of untrackedFiles) {
              const destPath = path.join(untrackedDir, ...file.split('/'));
              await mkdir(path.dirname(destPath), { recursive: true });
              await copyFile(path.join(mainRepoPath, ...file.split('/')), destPath);
            }
          }

          if (dirtyFiles.length > 0) {
            trackedDir = path.join(backupDir, 'tracked');
            for (const file of dirtyFiles) {
              const destPath = path.join(trackedDir, ...file.split('/'));
              await mkdir(path.dirname(destPath), { recursive: true });
              try {
                await copyFile(path.join(mainRepoPath, ...file.split('/')), destPath);
              } catch {
                deletedFiles.add(file);
              }
            }
          }

          await writeFile(path.join(backupDir, 'status.txt'), `${initialStatus}\n`, 'utf8');
          await writeFile(
            path.join(backupDir, 'fingerprint.json'),
            JSON.stringify(
              {
                createdAt: new Date().toISOString(),
                fingerprint: originalFingerprint,
              },
              null,
              2,
            ),
            'utf8',
          );

          return {
            dir: backupDir,
            stagedPatchPath,
            unstagedPatchPath,
            untrackedDir,
            untrackedFiles,
            trackedDir,
            trackedFiles: dirtyFiles,
            deletedFiles: Array.from(deletedFiles),
          };
        };

        const restoreDirtyBackup = async () => {
          if (!dirtyBackup) return;
          await runGit(mainRepoPath, ['reset', '--hard', 'HEAD']);
          await runGit(mainRepoPath, ['clean', '-fd']);
          if (dirtyBackup.stagedPatchPath) {
            await runGit(mainRepoPath, ['apply', '--cached', dirtyBackup.stagedPatchPath]);
          }
          if (dirtyBackup.trackedDir && dirtyBackup.trackedFiles.length > 0) {
            for (const file of dirtyBackup.trackedFiles) {
              const srcPath = path.join(dirtyBackup.trackedDir, ...file.split('/'));
              const destPath = path.join(mainRepoPath, ...file.split('/'));
              await mkdir(path.dirname(destPath), { recursive: true });
              await copyFile(srcPath, destPath);
            }
          }
          if (dirtyBackup.deletedFiles.length > 0) {
            for (const file of dirtyBackup.deletedFiles) {
              try {
                await runGit(mainRepoPath, ['rm', '-f', '--', file]);
              } catch {
                // Ignore delete failures
              }
            }
          }
          if (dirtyBackup.untrackedDir && dirtyBackup.untrackedFiles.length > 0) {
            for (const file of dirtyBackup.untrackedFiles) {
              const srcPath = path.join(dirtyBackup.untrackedDir, ...file.split('/'));
              const destPath = path.join(mainRepoPath, ...file.split('/'));
              await mkdir(path.dirname(destPath), { recursive: true });
              await copyFile(srcPath, destPath);
            }
          }
        };

        logger.warn(
          `[applyBack] Dirty changes overlap with patch files (${filesToApply.join(', ')}). Applying patch onto dirty workspace to preserve local changes.`,
        );
        dirtyBackup = await createDirtyBackup();
        logger.warn(`[applyBack] Dirty workspace checkpoint created at: ${dirtyBackup.dir}`);
        if (dirtyBackup.untrackedFiles.length > 0) {
          logger.warn(
            `[applyBack] Checkpoint includes untracked files: ${dirtyBackup.untrackedFiles.join(', ')}`,
          );
        }

        try {
          await assertFingerprintUnchanged(preparedFingerprint, 'dirty preparation');
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(`${msg}\nCheckpoint location: ${dirtyBackup?.dir || 'unknown'}`);
        }

        try {
          // CRITICAL: Re-verify fingerprint immediately before applying patch
          // This closes the time window between backup creation and patch application
          await assertFingerprintUnchanged(preparedFingerprint, 'pre-apply (dirty mode)');

          await applyPatch(mainRepoPath, patch, applyBackPatchOptions);
          patchApplied = true;
          applySuccess = true;
          return;
        } catch (error) {
          applyError = error instanceof Error ? error : new Error(String(error));
          try {
            await restoreDirtyBackup();
            const restoredStatus = await getStatus();
            if (restoredStatus !== initialStatus) {
              logger.warn(
                `[applyBack] Dirty workspace restore completed with status diff.\nBefore:\n${initialStatus}\nAfter:\n${restoredStatus}`,
              );
            }
          } catch (restoreError) {
            const restoreMsg =
              restoreError instanceof Error ? restoreError.message : String(restoreError);
            throw new Error(
              `${applyError.message}\nDirty workspace checkpoint restore failed: ${restoreMsg}\n` +
                `Checkpoint location: ${dirtyBackup?.dir || 'unknown'}`,
            );
          }
          throw applyError;
        }
      }

      if (wasDirty && applyBackOnDirty === 'stash') {
        const previousStashHead = await getStashHead();
        let stashCommandSucceeded = false;

        try {
          await runGit(mainRepoPath, [
            'stash',
            'push',
            '--include-untracked',
            '-m',
            'salmonloop-backup',
          ]);
          stashCommandSucceeded = true;
        } catch (error) {
          try {
            await runGit(mainRepoPath, ['stash', 'save', '-u', 'salmonloop-backup']);
            stashCommandSucceeded = true;
          } catch (fallbackError) {
            // Both stash commands failed
            const status = await getStatus();
            const errorMsg =
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            throw new Error(
              `Failed to stash local changes before apply-back.\nStash error: ${errorMsg}\nWorkspace status:\n${status || '(empty)'}`,
            );
          }
        }

        const newStashHead = await getStashHead();
        if (newStashHead && newStashHead !== previousStashHead) {
          stashRef = await resolveStashRef(newStashHead);
        }

        // Verify stash operation: if we had dirty files but no stash was created,
        // the stash command may have silently failed
        if (!stashRef && stashCommandSucceeded) {
          const status = await getStatus();
          // Repository was dirty before (wasDirty === true), so if no stash was created
          // and the repo is now clean, the stash must have worked without updating refs (unlikely but possible)
          // If the repo is still dirty, stash definitely failed
          if (status) {
            throw new Error(
              `Stash command appeared to succeed but no stash reference was created.\nWorkspace status:\n${status}`,
            );
          }
          // If status is empty and no stash was created, the repo must have been cleaned
          // by the stash operation even though no ref was updated. Log a warning but continue.
          logger.warn(
            '[applyBack] Stash operation cleaned workspace but did not create a stash reference.',
          );
        }

        const statusAfterStash = await getStatus();
        if (statusAfterStash) {
          const stashNote = stashRef ? `\nStash backup saved as ${stashRef}.` : '';
          throw new Error(
            `Apply-back aborted: main workspace still dirty after stashing.${stashNote}\n${statusAfterStash}`,
          );
        }
        preparedFingerprint = await computeFingerprint();
      }

      try {
        await assertFingerprintUnchanged(preparedFingerprint, 'preparation');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const stashNote = stashRef ? `\nStash backup saved as ${stashRef}.` : '';
        throw new Error(`${msg}${stashNote}`);
      }

      const getStashFiles = async (ref: string): Promise<string[]> => {
        try {
          const output = await runGit(mainRepoPath, ['stash', 'show', '--name-only', ref]);
          return output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        } catch {
          return [];
        }
      };

      // Apply patch to main workspace
      try {
        if (stashRef) {
          if (filesToApply.length > 0) {
            const stashFiles = await getStashFiles(stashRef);
            const overlap = stashFiles.filter((file) => filesToApply.includes(file));
            if (overlap.length > 0) {
              logger.warn(
                `[applyBack] Stashed changes overlap with patch files: ${overlap.join(', ')}.`,
              );
            }
          }
        }

        await applyPatch(mainRepoPath, patch, applyBackPatchOptions);
        patchApplied = true;
        applySuccess = true;
      } catch (error) {
        applyError = error instanceof Error ? error : new Error(String(error));

        // Rollback on failure
        if (stashRef) {
          try {
            await restoreStash(stashRef);
          } catch (rollbackError) {
            logger.warn(
              `Stash restore failed after apply-back error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            );
          }
        }
        throw error;
      }

      if (stashRef) {
        try {
          await restoreStash(stashRef);
        } catch (restoreError) {
          applySuccess = false;
          const restoreMsg =
            restoreError instanceof Error ? restoreError.message : String(restoreError);
          const filesToRollback = resolveChangedFiles();
          let rollbackDetail = '';

          if (patchApplied && filesToRollback.length > 0) {
            const rb = await rollbackFiles(mainRepoPath, filesToRollback, false);
            if (rb.ok) {
              rollbackDetail = `\nRollback succeeded for: ${filesToRollback.join(', ')}`;
            } else {
              rollbackDetail = `\nRollback failed: ${rb.stderr}`;
            }
          } else if (patchApplied) {
            rollbackDetail = '\nRollback skipped: no changed files detected.';
          }

          try {
            if (patchApplied && rollbackDetail && filesToRollback.length > 0) {
              await restoreStash(stashRef);
            }
          } catch (secondRestoreError) {
            const secondMsg =
              secondRestoreError instanceof Error
                ? secondRestoreError.message
                : String(secondRestoreError);
            rollbackDetail += `\nStash restore retry failed: ${secondMsg}`;
          }

          throw new Error(
            `${restoreMsg}${rollbackDetail}\nYour stash was left intact for manual recovery.`,
          );
        }
      }
    } finally {
      // Record monitoring metrics
      const duration = Date.now() - startTime;
      monitor.recordApplyBack(applySuccess, duration);
      logger.info(`applyBack completed in ${duration}ms, success: ${applySuccess}`);
    }
  }
}
