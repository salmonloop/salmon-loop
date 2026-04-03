import type { CompressedSession, PartialChatSession } from '../compression.js';
import type { ToolResultReplacementState } from '../replacement-state.js';
import type { ChatSession } from '../types.js';

export type ResumeRepairViolationCode =
  | 'ARCHIVE_NOT_FOUND'
  | 'ARCHIVE_CORRUPTED'
  | 'MALFORMED_BOUNDARY_METADATA'
  | 'MALFORMED_SESSION_BOUNDARY_METADATA'
  | 'MALFORMED_MESSAGE_BOUNDARY_METADATA'
  | 'MALFORMED_TAIL_ITERATION_METADATA'
  | 'STARTUP_HOOK_FAILED';

export interface ResumeRepairViolation {
  code: ResumeRepairViolationCode;
  message: string;
}

export interface ResumeRepairWarning {
  code: string;
  message: string;
}

export interface ResumeRepairAction {
  code: string;
  detail: string;
}

export interface ResumeRepairStartupHookContext {
  now: () => number;
  nextId: () => string;
}

export interface ResumeRepairStartupHook {
  key: string;
  run: (session: ChatSession, ctx: ResumeRepairStartupHookContext) => Promise<void> | void;
}

export interface ResumeRepairMutableState {
  archiveId: string;
  filename: string;
  compressed: CompressedSession;
  partial: PartialChatSession;
  session: ChatSession;
  replacementState?: ToolResultReplacementState;
  warnings: ResumeRepairWarning[];
  repairActions: ResumeRepairAction[];
  contractViolations: ResumeRepairViolation[];
}

export type ResumeRepairStage = (
  state: ResumeRepairMutableState,
  context: ResumeRepairPipelineContext,
) => Promise<void>;

export interface ResumeRepairResult {
  session?: ChatSession;
  replacementState?: ToolResultReplacementState;
  warnings: ResumeRepairWarning[];
  repairActions: ResumeRepairAction[];
  contractViolations: ResumeRepairViolation[];
}

export interface ResumeRepairPipelineContext {
  repoPath: string;
  now: () => number;
  nextId: () => string;
  startupHooks: ResumeRepairStartupHook[];
}
