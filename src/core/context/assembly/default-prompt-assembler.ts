import { formatContextForPrompt } from '../../llm/utils.js';
import type { Context } from '../../types/index.js';
import type { ContextRequest } from '../types.js';

import type { PromptAssembler } from './prompt-assembler.js';

export class DefaultPromptAssembler implements PromptAssembler {
  assemble(context: Context, _req: ContextRequest) {
    return { prompt: formatContextForPrompt(context, { format: 'json' }) };
  }
}
