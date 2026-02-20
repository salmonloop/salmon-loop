import type { ToolCallingAuditEntry } from '../../../llm/audit.js';
import type { DiffMeta } from '../../../patch/diff.js';
import { FileStateResolver } from '../../../strata/layers/file-state-resolver.js';
import type {
  ApplyBackTelemetry,
  WorkspaceSynchronizer,
} from '../../../strata/runtime/synchronizer.js';
import type { ArtifactHandle } from '../../../sub-agent/artifacts/types.js';
import type { ToolAuditLogger } from '../../../tools/audit.js';
import type { Toolstack } from '../../../tools/loader.js';
import type {
  CheckpointRef,
  Context,
  DebugArtifactRef,
  ExecutionWorkspace,
  FileSystem,
  FlowMode,
  LoopEvent,
  LoopOptions,
  Plan,
} from '../../../types/index.js';
import type { VerifyResult } from '../../../verification/runner.js';
import type { DecisionRecord } from '../../dsl/DecisionEngine.js';
import type { ExecutionResult } from '../../execution/Executor.js';

export interface PreflightResult {
  ok: boolean;
  reason?: string;
}

export interface ReviewSuggestion {
  type?: string;
  content?: string;
  [key: string]: unknown;
}

export type ReviewSuggestions = ReviewSuggestion | Array<ReviewSuggestion | string> | string | null;

export interface ApplyDecision {
  path: string;
  decisions: DecisionRecord[];
}

export interface ApplyResult {
  success: boolean;
  results: ExecutionResult[];
  successCount: number;
  totalFiles: number;
  decisions?: ApplyDecision[];
}

export interface ApplyBackRuntime {
  activeRepoPath: string;
  shadowTaskId: string;
  checkpointRef?: CheckpointRef;
  initialSnapshotHash?: string;
  synchronizer: WorkspaceSynchronizer;
}

export interface ApplyBackResult {
  success: boolean;
  skipped: boolean;
  telemetry: ApplyBackTelemetry;
  error?: string;
  errorCode?: string;
  safeMessage?: string;
  safeMeta?: Record<string, unknown>;
  debugArtifact?: DebugArtifactRef;
}

/**
 * Stage 0: Initial Context
 */
export interface InitCtx {
  workspace: ExecutionWorkspace;
  options: LoopOptions;
  mode: FlowMode;
  fs: FileSystem;
  emit: (event: LoopEvent) => void;
  fileStateResolver: FileStateResolver;
  /**
   * Runtime plan session for this run (local-only, gitignored).
   * The host initializes this once per task so both the host and LLM tools can update it.
   */
  planRuntime?: {
    sessionId: string;
    planPathHint: string;
  };
  attempt?: number;
  lastError?: string;
  toolstack?: Toolstack;
  toolAuditLogger?: ToolAuditLogger;
  toolCallingAudit?: ToolCallingAuditEntry[];
  /**
   * 🛡️ MANDATORY ROLLBACK ANCHOR:
   * This hash must be provided by the environment layer. Without it,
   * the loop cannot safely revert to a clean state upon verification failure.
   */
  shadowInitialRef: string;
  applyBackRuntime?: ApplyBackRuntime;
  initialContext?: Context; // For retry with shrunk context
}

/**
 * Stage 1: After Preflight
 */
export interface PreflightCtx extends InitCtx {
  preflightResult: PreflightResult;
}

/**
 * Stage 2: After Context Discovery
 */
export interface ContextCtx extends PreflightCtx {
  context: Context; // ContextBuilder result
}

export interface ReviewSummary {
  suggestions: ReviewSuggestions;
  timestamp: number;
}

export interface ReviewCtx extends ContextCtx {
  review: ReviewSummary;
}

/**
 * Stage 2.5: After Exploration
 */
export interface ExploreCtx extends ContextCtx {
  explorationSummary?: {
    filesFound: number;
    toolCallCount?: number;
  };
}

/**
 * Stage 3: After Plan Generation
 */
export interface PlanCtx extends ExploreCtx {
  plan: Plan;
}

/**
 * Stage 4: After Patch Generation
 */
export interface PatchCtx extends PlanCtx {
  diff: string;
  diffMeta: DiffMeta;
  changedFiles: string[];
}

/**
 * Stage 5: After Validation
 */
export interface ValidateCtx extends PatchCtx {
  isValid: boolean;
}

/**
 * Stage 5.5: After AST Validation
 */
export interface AstValidateCtx extends ValidateCtx {
  astValid: boolean;
  astError?: string;
}

/**
 * Stage 6: After Application (Result)
 */
export interface ApplyCtx extends AstValidateCtx {
  applyResult: ApplyResult;
}

/**
 * Stage 7: After Verification
 */
export interface VerifyCtx extends ApplyCtx {
  verifyResult: VerifyResult;
  verifyArtifact?: ArtifactHandle;
}

/**
 * Stage 8: After Rollback (if needed)
 */
export interface RollbackCtx extends VerifyCtx {
  rolledBack: boolean;
}

/**
 * Final Result
 */
export interface ShrinkCtx extends RollbackCtx {
  shrunk: boolean;
  lastError?: string;
  applyBackResult?: ApplyBackResult;
}
