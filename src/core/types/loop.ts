import type { ResolvedExtensions } from '../extensions/types.js';
import type { RunOutcomeReporter } from '../observability/run-outcome-reporter.js';
import type { ArtifactHandle } from '../sub-agent/artifacts/types.js';
import type { ToolAuthorizationProvider } from '../tools/authorization/types.js';

import type { AuthorizationDecisionRecord } from './authorization.js';
import type {
  ApplyBackOnDirty,
  ErrorType,
  ExecutionPhase,
  ExecutionStep,
  FlowMode,
  VerboseLevel,
} from './execution.js';
import type { LLM, LlmOutputKind, LlmOutputPolicy } from './llm.js';
import type { Plan } from './planning.js';
import type { TokenUsage } from './usage.js';

export type LoopReasonCode =
  | 'PREFLIGHT_DIRTY'
  | 'PREFLIGHT_NOT_GIT'
  | 'DRY_RUN'
  | 'VERIFY_FAILED'
  | 'ROLLBACK_FAILED'
  | 'LOOP_FAILED'
  | 'MAX_RETRIES'
  | 'APPLY_BACK_FAILED'
  | 'LOOP_CRASH'
  | 'SUCCESS';

export interface LoopIteration {
  attempt: number;
  plan: Plan | null;
  patch: string | null;
  error?: string;
  contextSummary: string;
}

export interface StepLog {
  step: ExecutionPhase | 'error' | 'UNKNOWN';
  success: boolean;
  output: string;
  timestamp: Date;
}

export interface AuthorizationSourceSummary {
  auto: number;
  allowlist: number;
  user: number;
  cache: number;
  cli: number;
  hook: number;
}

export interface LoopResult {
  success: boolean;
  reason: string;
  reasonCode: LoopReasonCode;
  attempts: number;
  logs: StepLog[];
  usage?: TokenUsage;
  authorizationDecisions?: AuthorizationDecisionRecord[];
  history?: LoopIteration[];
  finalPatch?: string;
  failurePhase?: ExecutionPhase;
  changedFiles?: string[];
  errorType?: ErrorType;
  errorCode?: string;
  auditPath?: string;
  verifyArtifact?: ArtifactHandle;
  authorizationSummary?: AuthorizationSourceSummary;
  strategyName?: string;
  fsMode?: FlowMode;
}

/**
 * Events emitted during the SalmonLoop execution.
 */
export type LoopEvent =
  | { type: 'phase.start'; phase: ExecutionPhase; timestamp: Date }
  | { type: 'phase.end'; phase: ExecutionPhase; success: boolean; timestamp: Date }
  | {
      type: 'ui.status';
      action: 'set' | 'clear';
      face?: string;
      label?: string;
      ttlMs?: number;
      timestamp: Date;
    }
  | {
      type: 'log';
      message: string;
      code?: string;
      /**
       * Optional origin for the log line. Used by GUI to attribute messages
       * without relying on raw stdout/stderr.
       */
      source?: string;
      level: 'info' | 'warn' | 'error' | 'debug' | 'trace';
      timestamp: Date;
    }
  | {
      type: 'diff.meta';
      changedFiles: string[];
      fileCount: number;
      lineCount: number;
      timestamp: Date;
    }
  | { type: 'verify.result'; ok: boolean; output: string; timestamp: Date }
  | {
      type: 'retry';
      fromAttempt: number;
      toAttempt: number;
      reason: string;
      failedFiles: string[];
      timestamp: Date;
    }
  | {
      type: 'checkpoint.created';
      worktreePath: string;
      baseRef: string;
      timestamp: Date;
    }
  | {
      type: 'snapshot.created';
      commitHash: string;
      timestamp: Date;
    }
  | {
      type: 'checkpoint.cleaned';
      ok: boolean;
      timestamp: Date;
    }
  | {
      type: 'workspace.ready';
      path: string;
      strategy: string;
      timestamp: Date;
    }
  | {
      type: 'action.fallback';
      tool: string;
      method: string;
      reason: string;
      severity: 'low' | 'medium' | 'high';
      timestamp: Date;
    }
  | {
      type: 'resource.status';
      resource: string;
      status: 'skipped' | 'degraded' | 'recovered' | 'warning';
      message: string;
      timestamp: Date;
    }
  | {
      type: 'resource.cleanup';
      path: string;
      success: boolean;
      timestamp: Date;
    }
  | {
      type: 'authorization.summary';
      summary: AuthorizationSourceSummary;
      stage: 'realtime' | 'final';
      timestamp: Date;
    }
  | {
      type: 'authorization.decision';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      outcome: string;
      reason?: string;
      ttlMs?: number;
      persist?: 'repo' | 'user';
      source?: string;
      riskLevel?: string;
      sideEffects?: string[];
      timestamp: Date;
    }
  | {
      type: 'run.start';
      mode: 'run' | 'chat';
      timestamp: Date;
    }
  | {
      type: 'run.end';
      mode: 'run' | 'chat';
      success: boolean;
      timestamp: Date;
    }
  | {
      type: 'plan.runtime.ready';
      sessionId: string;
      planPathHint: string;
      timestamp: Date;
    }
  | {
      type: 'plan.runtime.unavailable';
      reason: string;
      timestamp: Date;
    }
  | {
      type: 'plan.runtime.journal';
      sessionId: string;
      phase: ExecutionPhase;
      kind: 'start' | 'end';
      attempt: number;
      ok: boolean;
      timestamp: Date;
    }
  | {
      type: 'tool.call.start';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      round: number;
      input?: unknown;
      timestamp: Date;
    }
  | {
      type: 'tool.call.end';
      callId: string;
      toolName: string;
      phase: ExecutionPhase;
      round: number;
      status: 'ok' | 'denied' | 'error' | 'timeout';
      durationMs?: number;
      errorCode?: string;
      outputSummary?: string;
      timestamp: Date;
    }
  | {
      type: 'llm.stream.delta';
      kind: LlmOutputKind;
      step: ExecutionStep;
      streamId: string;
      content: string;
      timestamp: Date;
    }
  | {
      type: 'llm.stream.end';
      kind: LlmOutputKind;
      step: ExecutionStep;
      streamId: string;
      finishReason?: string;
      timestamp: Date;
    }
  | {
      type: 'llm.output';
      kind: LlmOutputKind;
      step: ExecutionStep;
      content: string;
      timestamp: Date;
    };

export type CheckpointStrategy = 'direct' | 'worktree' | 'tempCommit';

export interface CheckpointRef {
  strategy: 'worktree';
  repoPath: string;
  worktreePath: string;
  baseRef: string;
  branchName: string;
}

export interface RunOptions {
  instruction: string;
  verify?: string;
  repoPath: string;
  file?: string;
  contextFiles?: string[];
  selection?: string;
  dryRun?: boolean;
  forceReset?: boolean;
  onEvent?: (event: LoopEvent) => void;
  verbose?: VerboseLevel;
  strategy?: CheckpointStrategy;
  applyBackOnDirty?: ApplyBackOnDirty;
  worktreePrepare?: string;
  expectedChanges?: string[];
  expectedFileContent?: { path: string; content: string }[];
  targetNodeName?: string;
  snapshotHash?: string;
  checkpointManager?: import('../strata/checkpoint/manager.js').CheckpointManager;
  checkpoint?: {
    strategy?: 'worktree';
    keepWorktreeOnFailure?: boolean;
    applyBack?: 'patch' | 'cherry-pick';
  };
  signal?: AbortSignal;
}

export interface LoopOptions {
  instruction: string;
  verify?: string;
  repoPath: string;
  signal?: AbortSignal;
  llm: LLM;
  /**
   * Optional Langfuse sessionId. If set, multiple runs will be grouped under a single Langfuse Session.
   * Chat mode will typically pass the local chat session ID.
   */
  langfuseSessionId?: string;
  /**
   * Optional Langfuse userId. Intended for SaaS / multi-user deployments.
   */
  langfuseUserId?: string;
  allowedToolNames?: string[];
  permissionRules?: import('../tools/permissions/permission-rules.js').RawPermissionRulesInput;
  timeoutMs?: number;
  recursionDepth?: number;
  mode?: FlowMode;
  dryRun?: boolean;
  forceReset?: boolean;
  shadowInitialRef?: string;
  onEvent?: (event: LoopEvent) => void;
  verbose?: VerboseLevel;
  file?: string;
  contextFiles?: string[];
  selection?: string;
  expectedChanges?: string[];
  expectedFileContent?: { path: string; content: string }[];
  targetNodeName?: string;
  strategy?: CheckpointStrategy;
  applyBackOnDirty?: ApplyBackOnDirty;
  worktreePrepare?: string;
  llmOutput?: LlmOutputPolicy;
  authorizationProvider?: ToolAuthorizationProvider;
  authorizationMode?: 'blocking' | 'deferred';
  extensions?: ResolvedExtensions;
  outcomeReporter?: RunOutcomeReporter;
  eventPayload?: {
    includeToolInput?: boolean;
    includeToolOutput?: boolean;
    includeAuthorizationDecisions?: boolean;
  };
}

export interface ExecutionWorkspace {
  baseRepoPath: string;
  workPath: string;
  strategy: CheckpointStrategy;
}
