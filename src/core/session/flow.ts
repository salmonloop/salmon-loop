import { randomBytes } from 'crypto';

import { runSalmonLoop } from '../runtime/loop.js';
import type { CheckpointManager } from '../strata/checkpoint/manager.js';
import type { LLM } from '../types.js';

import type { BaseSessionCtx, InstructionCtx, ExecutedCtx, SnapshotCtx } from './types.js';

/**
 * Type-safe execution flow for chat sessions.
 * Inspired by Grizzco DSL pattern with progressive context.
 *
 * Usage:
 * ```typescript
 * const ctx = await ChatFlow.of(baseSession)
 *   .withInstruction('Fix bug', 'npm test')
 *   .execute(llm, options)
 *   .snapshot(checkpointManager)  // optional
 *   .finalize();
 * ```
 */
export class ChatFlow<CurrentCtx> {
  private constructor(private readonly data: Promise<CurrentCtx>) {}

  /**
   * Initialize flow with base session context
   */
  static of(ctx: BaseSessionCtx): ChatFlow<BaseSessionCtx> {
    return new ChatFlow(Promise.resolve(ctx));
  }

  /**
   * Add user instruction to context
   * Type narrows: BaseSessionCtx -> InstructionCtx
   */
  withInstruction(instruction: string, verifyCommand: string): ChatFlow<InstructionCtx> {
    return new ChatFlow(
      this.data.then((ctx) => ({
        ...(ctx as BaseSessionCtx),
        currentInstruction: instruction,
        verifyCommand,
      })) as Promise<InstructionCtx>,
    );
  }

  /**
   * Execute SalmonLoop with current instruction
   * Type narrows: InstructionCtx -> ExecutedCtx
   */
  execute(llm: LLM, options?: any): ChatFlow<ExecutedCtx> {
    return new ChatFlow(
      this.data.then(async (ctx) => {
        const instructionCtx = ctx as InstructionCtx;
        const result = await runSalmonLoop({
          instruction: instructionCtx.currentInstruction,
          verify: instructionCtx.verifyCommand,
          repoPath: instructionCtx.repoPath,
          llm,
          verbose: options?.verbose,
          onEvent: options?.onEvent,
        });

        const iteration = {
          id: randomBytes(4).toString('hex'),
          ...(result.history?.[result.history.length - 1] || {}),
        };

        return {
          ...instructionCtx,
          iteration,
          result,
        } as ExecutedCtx;
      }),
    );
  }

  /**
   * Create checkpoint snapshot (optional step)
   * Type narrows: ExecutedCtx -> SnapshotCtx
   */
  snapshot(checkpointManager: CheckpointManager): ChatFlow<SnapshotCtx> {
    return new ChatFlow(
      this.data.then(async (ctx) => {
        const executedCtx = ctx as ExecutedCtx;
        const { commitHash } = await checkpointManager.createSafeSnapshot(
          executedCtx.repoPath,
          [],
          `Chat iteration ${executedCtx.iteration.id}`,
        );
        return {
          ...executedCtx,
          snapshotHash: commitHash,
        } as SnapshotCtx;
      }),
    );
  }

  /**
   * Finalize flow and return typed result
   */
  async finalize(): Promise<CurrentCtx> {
    return this.data;
  }
}
