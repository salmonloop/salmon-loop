/**
 * SalmonLoop - A self-healing loop for code generation and verification.
 *
 * This is the main entry point for the SalmonLoop library.
 */

export { runSalmonLoop } from './core/loop.js';
export type { LoopOptions } from './core/loop.js';
export { ExecutionPhase, ErrorType } from './core/types.js';
export type {
  LoopResult,
  StepLog,
  LoopEvent,
  LoopIteration,
  Plan,
  PlanStep,
  CheckpointStrategy,
  ExecutionWorkspace,
} from './core/types.js';
export type { LLM } from './core/llm.js';
export { OpenAILLM, StubLLM, FakeLLM } from './core/llm.js';
export { WorkspaceManager } from './core/workspace.js';
