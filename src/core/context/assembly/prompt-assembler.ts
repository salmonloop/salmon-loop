import type { Context } from '../../types/context.js';
import type { ContextBuildMeta, ContextRequest } from '../types.js';

export interface AssembleResult {
  prompt: string;
  meta?: Partial<ContextBuildMeta>;
}

export interface PromptAssembler {
  assemble(context: Context, req: ContextRequest): AssembleResult;
}
