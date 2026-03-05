export { createRunSalmonLoop, runSalmonLoop, SalmonLoop } from './core/runtime/loop.js';
export { AiSdkLLM, StubLLM } from './core/llm/index.js';

export type {
  AuthorizationDecisionRecord,
  AuthorizationDecisionSource,
  AuthorizationOutcome,
  AuthorizationPersistScope,
} from './core/types/authorization.js';
export type {
  Context,
  ContextTarget,
  RelatedFileContext,
  SymbolInfo,
} from './core/types/context.js';
export {
  DiffValidationError,
  GitError,
  PatchNotApplicableError,
  SalmonError,
} from './core/types/errors.js';
export type { ErrorDomain, ErrorEnvelope } from './core/types/errors.js';
export type {
  ApplyBackOnDirty,
  EnvironmentMode,
  ExecutionPhase,
  ExecutionStep,
  FileSystem,
  FlowMode,
  Phase,
  VerboseLevel,
} from './core/types/execution.js';
export type {
  ChatOptions,
  LLM,
  LLMMessage,
  LLMRole,
  LLMStreamChunk,
  LlmOutputKind,
  LlmOutputPolicy,
} from './core/types/llm.js';
export type {
  AskUserInput,
  AskUserOutput,
  AskUserQuestion,
  AskUserOption,
  AuthorizationSourceSummary,
  CheckpointStrategy,
  LoopEvent,
  LoopInputRequired,
  LoopIteration,
  LoopOptions,
  LoopReasonCode,
  LoopResult,
  StepLog,
  UserInputProvider,
} from './core/types/loop.js';
export type { Plan } from './core/types/planning.js';
export type { TokenUsage } from './core/types/usage.js';
