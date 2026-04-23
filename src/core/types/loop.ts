import type { PermissionMode } from '../config/types.js';
import type { BudgetRunSummary } from '../context/budget/dynamic-adjuster.js';
import type { ResolvedExtensions } from '../extensions/types.js';
import type { RunOutcomeReporter } from '../observability/run-outcome-reporter.js';
import type { PluginRegistry } from '../plugin/registry.js';
import type { ToolResultReplacementState } from '../session/replacement-state.js';
import type {
  CanonicalResponsesEvent,
  CanonicalResponsesEventSource,
} from '../streaming/canonical/responses-events.js';
import type { ArtifactHandle } from '../sub-agent/artifacts/types.js';
import type { SubAgentControllerPort } from '../sub-agent/controller.js';
import type { ToolAuthorizationProvider } from '../tools/authorization/types.js';

import type { AuthorizationDecisionRecord } from './authorization.js';
import type { ErrorEnvelope } from './errors.js';
import type {
  ApplyBackOnDirty,
  EnvironmentMode,
  ErrorType,
  ExecutionPhase,
  ExecutionStep,
  FileSystem,
  FlowMode,
  VerboseLevel,
} from './execution.js';
import type { LLM, LLMMessage, LlmOutputKind, LlmOutputPolicy } from './llm.js';
import type { Plan } from './planning.js';
import type { TokenUsage } from './usage.js';

export type LoopReasonCode =
  | 'PREFLIGHT_DIRTY'
  | 'PREFLIGHT_NOT_GIT'
  | 'DRY_RUN'
  | 'VERIFY_FAILED'
  | 'TOOL_CORRECTION_REQUIRED'
  | 'ROLLBACK_FAILED'
  | 'LOOP_FAILED'
  | 'MAX_RETRIES'
  | 'APPLY_BACK_FAILED'
  | 'LOOP_CRASH'
  | 'AWAITING_INPUT'
  | 'SUCCESS';

export type RootCauseCode =
  | 'LLM_RATE_LIMITED'
  | 'LLM_UPSTREAM_5XX'
  | 'LLM_NETWORK_UNREACHABLE'
  | 'LLM_REQUEST_TIMEOUT'
  | 'PLAN_OUTPUT_NOT_JSON'
  | 'PLAN_SCHEMA_INVALID'
  | 'STDOUT_CONTRACT_VIOLATION'
  | 'RESOURCE_LIMIT_CONFIRMED';

export type TerminalReason = 'RETRY_BUDGET_EXHAUSTED' | 'NON_RETRYABLE_FAILURE' | 'USER_ABORTED';

export interface AskUserOption {
  label: string;
  description: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect: boolean;
}

export interface AskUserInput {
  questions: AskUserQuestion[];
}

export interface AskUserOutput {
  questions: AskUserQuestion[];
  answers: Record<string, string>;
}

export interface UserInputProvider {
  askUser: (input: AskUserInput, options?: { signal?: AbortSignal }) => Promise<AskUserOutput>;
}

export interface LoopInputRequired {
  type: string;
  reason?: 'approval' | 'clarification' | 'reopen';
  prompt: string;
  questions?: AskUserQuestion[];
  responseFormat?: 'json';
}

export interface LoopIteration {
  attempt: number;
  plan: Plan | null;
  patch: string | null;
  error?: string;
  contextSummary: string;
}

export interface LoopArtifactHints {
  verifyArtifact?: ArtifactHandle;
  subAgentPatchArtifacts?: ArtifactHandle[];
  subAgentAuditArtifacts?: ArtifactHandle[];
  recentReadArtifacts?: Array<{
    path: string;
    artifact: ArtifactHandle;
  }>;
  toolResultPreviewArtifacts?: Array<{
    label: string;
    artifact: ArtifactHandle;
  }>;
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
  terminalReason?: TerminalReason;
  rootCause?: RootCauseCode;
  diagnosticCode?: string;
  safeHint?: string;
  remediationSteps?: string[];
  errorEnvelope?: ErrorEnvelope;
  attempts: number;
  contextHash?: string;
  logs: StepLog[];
  usage?: TokenUsage;
  authorizationDecisions?: AuthorizationDecisionRecord[];
  history?: LoopIteration[];
  finalPatch?: string;
  /**
   * Optional user-facing message produced by read-only flows (e.g. answer).
   * Chat mode can use this as the assistant transcript content.
   */
  assistantMessage?: string;
  failurePhase?: ExecutionPhase;
  changedFiles?: string[];
  errorType?: ErrorType;
  errorCode?: string;
  auditPath?: string;
  verifyArtifact?: ArtifactHandle;
  artifactHints?: LoopArtifactHints;
  authorizationSummary?: AuthorizationSourceSummary;
  strategyName?: string;
  fsMode?: FlowMode;
  budgetSummary?: BudgetRunSummary;
  inputRequired?: LoopInputRequired;
}

/**
 * Events emitted during the SalmonLoop execution.
 */
export type LoopEvent =
  | {
      type: 'task.awaiting_input';
      reason: 'approval' | 'clarification' | 'reopen';
      prompt: string;
      inputRequired?: LoopInputRequired;
      timestamp: Date;
    }
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
      toolIntent?: string;
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
      type: 'llm.responses.event';
      kind: LlmOutputKind;
      step: ExecutionStep;
      streamId: string;
      phase?: ExecutionPhase;
      round?: number;
      source?: CanonicalResponsesEventSource;
      event: CanonicalResponsesEvent;
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
  environmentMode?: EnvironmentMode;
  worktreePrepare?: string;
  expectedChanges?: string[];
  expectedFileContent?: { path: string; content: string }[];
  snapshotHash?: string;
  checkpointManager?: import('../strata/checkpoint/manager.js').CheckpointManager;
  checkpoint?: {
    strategy?: 'worktree';
    keepWorktreeOnFailure?: boolean;
    applyBack?: 'patch' | 'cherry-pick';
  };
  signal?: AbortSignal;
  budgetChars?: number;
  allowOutsideCacheRoot?: boolean;
  authorizationProvider?: ToolAuthorizationProvider;
}

export interface LoopOptions {
  instruction: string;
  checkpointSessionId?: string;
  verify?: string;
  repoPath: string;
  fileSystemOverride?: FileSystem;
  signal?: AbortSignal;
  llm: LLM;
  /**
   * Optional conversation history injected into LLM message-based prompts.
   *
   * This is adapter- and protocol-neutral: it only carries basic LLM messages and
   * does not expose any provider-specific fields.
   *
   * Typical usage:
   * - CLI: build from a persisted chat session when `--continue/--resume` is used.
   * - GUI/TUI: hydrate from local state for seamless multi-turn experiences.
   */
  conversationContext?: LLMMessage[];
  /**
   * Optional artifact hints carried across independent runs/sessions.
   * This allows resume/fork paths to preserve artifact-first context continuity.
   */
  artifactHints?: LoopArtifactHints;
  /**
   * Optional persisted replacement decisions for tool result previews.
   * This keeps model-visible replacement bytes stable across resume/fork.
   */
  replacementState?: ToolResultReplacementState;
  auditScope?: 'repo' | 'user';
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
  permissionMode?: PermissionMode;
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
  allowOutsideCacheRoot?: boolean;
  strategy?: CheckpointStrategy;
  applyBackOnDirty?: ApplyBackOnDirty;
  environmentMode?: EnvironmentMode;
  astValidation?: {
    strictness?: 'lenient' | 'strict';
  };
  worktreePrepare?: string;
  llmOutput?: LlmOutputPolicy;
  authorizationProvider?: ToolAuthorizationProvider;
  authorizationMode?: 'blocking' | 'deferred';
  extensions?: ResolvedExtensions;
  outcomeReporter?: RunOutcomeReporter;
  budgetChars?: number;
  userInputProvider?: UserInputProvider;
  agentKind?: 'primary' | 'subagent';
  /**
   * Optional language plugin registry for AST/language-aware logic.
   * CLI/servers should initialize and pass this at startup.
   */
  languagePlugins?: PluginRegistry;
  /**
   * Optional sub-agent controller instance to share Smallfry state with the host UI.
   * If omitted, sub-agent orchestration tools may create a private controller.
   */
  subAgentController?: SubAgentControllerPort;
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
  environmentMode?: EnvironmentMode;
}
