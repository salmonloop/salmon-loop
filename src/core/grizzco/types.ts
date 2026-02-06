import { FileStateResolver } from '../strata/layers/file-state-resolver.js';
import type { ArtifactHandle } from '../sub-agent/artifacts/types.js';
import type { FileSystem, FlowMode } from '../types.js';
import type { VerifyResult } from '../verify.js';

/**
 * Stage 0: Initial Context
 */
export interface InitCtx {
  workspace: any; // Will be typed properly later
  options: any; // Will be typed properly later
  mode: FlowMode;
  fs: FileSystem;
  emit: (event: any) => void;
  fileStateResolver: FileStateResolver;
  attempt?: number;
  lastError?: string;
  toolAuditLogger?: { getLogs(): unknown[] };
  /**
   * 🛡️ MANDATORY ROLLBACK ANCHOR:
   * This hash must be provided by the environment layer. Without it,
   * the loop cannot safely revert to a clean state upon verification failure.
   */
  shadowInitialRef: string;
  initialContext?: any; // For retry with shrunk context
}

/**
 * Stage 1: After Preflight
 */
export interface PreflightCtx extends InitCtx {
  preflightResult: {
    ok: boolean;
    reason?: string;
  };
}

/**
 * Stage 2: After Context Discovery
 */
export interface ContextCtx extends PreflightCtx {
  context: any; // ContextBuilder result
}

export interface ReviewSummary {
  suggestions: unknown;
  timestamp: number;
}

export interface ReviewCtx extends ContextCtx {
  review: ReviewSummary;
}

/**
 * Stage 3: After Plan Generation
 */
export interface PlanCtx extends ContextCtx {
  plan: any; // LLM Plan
}

/**
 * Stage 4: After Patch Generation
 */
export interface PatchCtx extends PlanCtx {
  diff: string;
  diffMeta: any;
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
  applyResult: {
    success: boolean;
    results: any[];
    successCount: number;
    totalFiles: number;
    decisions?: any[]; // For audit
  };
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
}
