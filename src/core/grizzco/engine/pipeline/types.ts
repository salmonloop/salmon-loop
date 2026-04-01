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
import type { Context } from '../../../types/context.js';
import type { DebugArtifactRef } from '../../../types/errors.js';
import type { CheckpointRef, ExecutionWorkspace } from '../../../types/loop.js';
import type { Plan } from '../../../types/planning.js';
import type { FileSystem, FlowMode, LoopEvent, LoopOptions } from '../../../types/runtime.js';
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
  artifactHints?: {
    verifyArtifact?: ArtifactHandle;
  };
}

/**
 * Stage 1: After Preflight
 */
export interface PreflightCtx extends InitCtx {
  preflightResult: PreflightResult;
}

/**
 * Stage 1.5: After Dependency Preparation
 */
export type PrepareDepsCtx = PreflightCtx;

/**
 * Stage 2: After Context Discovery
 */
export interface ContextCtx extends PrepareDepsCtx {
  context: Context; // ContextBuilder result
  contextResult?: import('../../../context/types.js').ContextResult; // For budget tracking
}

export interface ReviewSummary {
  suggestions: ReviewSuggestions;
  timestamp: number;
}

export interface ReviewCtx extends ContextCtx, ReportableCtx {
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

export interface ResearchSource {
  toolName: string;
  summary?: string;
  ok?: boolean;
  timestamp: number;
}

export interface ResearchFinding {
  summary: string;
  confidence?: number;
  uncertainty?: string;
}

export type ReportKind = 'review' | 'research' | 'answer';

export interface ReportPayload {
  kind: ReportKind;
  summary?: string;
  suggestions?: ReviewSummary['suggestions'];
  findings?: ResearchFinding[];
  timestamp: number;
}

/**
 * Marker interface for contexts that can be rendered via the REPORT step.
 *
 * Note: this intentionally does not imply a discovered repository `context`.
 * Some lightweight modes (e.g. answer) are read-only and may skip CONTEXT/EXPLORE.
 */
export interface ReportableCtx {
  report: ReportPayload;
}

/**
 * Answer mode is a lightweight, read-only flow that produces a user-facing response
 * (optionally with read-only tool assistance) without mutating the repository.
 */
export interface AnswerCtx extends PreflightCtx, ReportableCtx {}

export type TerminalCtx = AnswerCtx | ReviewCtx | ResearchCtx | ShrinkCtx;

/**
 * Stage 2.75: After Research
 */
export interface ResearchCtx extends ExploreCtx, ReportableCtx {
  researchNotes: unknown[];
  researchFindings: ResearchFinding[];
  sources: ResearchSource[];
  researchText: string;
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
