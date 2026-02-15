import type { LLMMessage } from '../types/index.js';
import type { LoopIteration, LoopResult } from '../types/index.js';

/**
 * Single message in chat history
 */
export interface ChatMessage extends LLMMessage {
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
