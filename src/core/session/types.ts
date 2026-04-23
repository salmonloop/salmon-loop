import type { FlowMode } from '../types/execution.js';
import type { LLMMessage } from '../types/index.js';
import type { LoopIteration, LoopResult } from '../types/index.js';

import type { SessionArtifactState } from './artifact-state.js';
import type { ToolResultReplacementState } from './replacement-state.js';

/**
 * Single message in chat history
 */
export interface ChatMessage extends LLMMessage {
  id?: string;
  timestamp: number;
  /** Links message to execution iteration */
  iterationId?: string;
}

/**
 * Summary state for conversation summarization.
 * Persisted across sessions.
 */
export interface SummaryState {
  /** Current cumulative summary */
  summary: string;
  /** Token count of current summary */
  summaryTokens: number;
  /** Message IDs already summarized */
  summarizedMessageIds: string[];
  /** Last summary timestamp */
  lastSummarizedAt: number;
  /** Summary schema version for compatibility */
  summaryVersion?: number;
  /** Canonical structured state to prevent drift */
  structuredState?: {
    decisions: string[];
    constraints: string[];
    open_questions: string[];
    pending_tasks: string[];
    rejected_options: string[];
    assumptions: string[];
    risks: string[];
    owner: string[];
  };
  /** Context hash used to validate summary alignment */
  contextHash?: string;
  /** Minimal working-state recovery payload preserved across compaction. */
  recoveryState?: RecoveryState;
}

export interface RecoveryFailureSummary {
  reasonCode?: string;
  diagnosticCode?: string;
  safeHint?: string;
  failurePhase?: string;
}

export interface RecoveryState {
  flowMode?: FlowMode;
  lastFailureSummary?: RecoveryFailureSummary;
  recentReadFiles?: string[];
}

/**
 * Session metadata (stored in JSON)
 */
export interface SessionMetadata {
  id: string;
  name: string;
  repoPath: string;
  createdAt: number;
  updatedAt: number;

  // Execution statistics
  totalIterations: number;
  successfulIterations: number;

  // Token tracking
  totalTokens: {
    input: number;
    output: number;
  };

  // Snapshot tracking (links to CheckpointManager)
  snapshots: Array<{
    id: string; // Snapshot commit hash
    iterationId: string; // Which iteration created it
    timestamp: number;
  }>;

  // Conversation summary state
  summaryState?: SummaryState;
  artifactState?: SessionArtifactState;
  replacementState?: ToolResultReplacementState;
  chatState?: {
    flowMode?: FlowMode;
  };
  resumeRepairState?: {
    schemaVersion: number;
    lastRunAt: number;
    warnings: string[];
    repairActions: string[];
    contractViolations: string[];
  };
}

/**
 * Complete chat session (persisted to disk)
 */
export interface ChatSession {
  meta: SessionMetadata;

  // Conversation history
  messages: ChatMessage[];

  // Execution history (reuses existing type)
  iterations: Array<LoopIteration & { id: string }>;

  // Current state
  currentInstruction?: string;
  currentVerifyCommand?: string;
}

/**
 * Progressive Context Pattern (Grizzco V3)
 */

/**
 * Stage 0: Base session context
 */
export interface BaseSessionCtx {
  sessionId: string;
  repoPath: string;
  messages: ChatMessage[];
}

/**
 * Stage 1: With user instruction
 */
export interface InstructionCtx extends BaseSessionCtx {
  currentInstruction: string;
  verifyCommand: string;
}

/**
 * Stage 2: After execution
 */
export interface ExecutedCtx extends InstructionCtx {
  iteration: LoopIteration & { id: string };
  result: LoopResult;
}

/**
 * Stage 3: After snapshot
 */
export interface SnapshotCtx extends ExecutedCtx {
  snapshotHash: string;
}
