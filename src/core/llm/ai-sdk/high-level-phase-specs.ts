import { LIMITS } from '../../config/limits.js';
import { getPatchPrompt, getPlanPrompt } from '../../prompts/runtime.js';
import type { Context } from '../../types/context.js';
import type { Plan } from '../../types/planning.js';
import { wrapPlanEmpty, sanitizeError, LlmError } from '../errors.js';
import type { RequestAttachment } from '../request-envelope.js';
import {
  extractUnifiedDiffFromLLMContent,
  parsePlanFromLLMContent,
} from '../utils.js';

export interface HighLevelPhaseSpec<TInput, TOutput> {
  namespace: string;
  observationName: string;
  buildPrompt: (input: TInput & { contextPrompt: string }) => Promise<string>;
  buildAttachments: (input: TInput & { contextPrompt: string }) => RequestAttachment[];
  parseResult: (content: string | undefined) => TOutput;
}

export interface PlanPhaseInput {
  context: Context;
  instruction: string;
  lastError?: string;
  signal?: AbortSignal;
}

export interface PatchPhaseInput {
  context: Context;
  planStr: string;
  lastError?: string;
  signal?: AbortSignal;
}

function buildContextPromptAttachment(contextPrompt: string): RequestAttachment {
  return {
    key: 'context-prompt',
    kind: 'context',
    label: 'Context prompt',
    content: contextPrompt,
    cacheSafe: true,
  };
}

function buildPatchAttachments(contextPrompt: string, planStr: string): RequestAttachment[] {
  return [
    buildContextPromptAttachment(contextPrompt),
    {
      key: 'plan-json',
      kind: 'plan',
      label: 'Plan JSON',
      content: planStr,
    },
  ];
}

function parsePlanResult(content: string | undefined): Plan {
  if (!content) {
    throw wrapPlanEmpty();
  }

  try {
    return parsePlanFromLLMContent(content);
  } catch (e) {
    throw new LlmError('LLM plan parsing failed', 'LLM_PLAN_INVALID_JSON', {
      causeMessage: sanitizeError(e),
    });
  }
}

function parsePatchResult(content: string | undefined): string {
  return extractUnifiedDiffFromLLMContent(content ?? '');
}

export const HIGH_LEVEL_PHASE_SPECS: {
  plan: HighLevelPhaseSpec<PlanPhaseInput, Plan>;
  patch: HighLevelPhaseSpec<PatchPhaseInput, string>;
} = {
  plan: {
    namespace: 'plan',
    observationName: 'PLAN:plan-json',
    buildPrompt: async ({ contextPrompt, instruction, lastError }) =>
      getPlanPrompt(contextPrompt, instruction, LIMITS.maxFilesChanged, lastError),
    buildAttachments: ({ contextPrompt }) => [buildContextPromptAttachment(contextPrompt)],
    parseResult: (content) => parsePlanResult(content),
  },
  patch: {
    namespace: 'patch',
    observationName: 'PATCH:unified-diff',
    buildPrompt: async ({ planStr, contextPrompt, lastError }) =>
      getPatchPrompt(
        planStr,
        contextPrompt,
        LIMITS.maxFilesChanged,
        LIMITS.maxDiffLines,
        lastError,
      ),
    buildAttachments: ({ contextPrompt, planStr }) => buildPatchAttachments(contextPrompt, planStr),
    parseResult: (content) => parsePatchResult(content),
  },
};
