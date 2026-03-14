import type { TaskRequest } from '../../interaction/model/index.js';

export type CanonicalExecutionRequest = {
  capability: string;
  request: TaskRequest;
  taskId?: string;
};

export type InstructionNormalizationOptions = {
  fallbackInstruction?: string;
};

export function normalizeInstructionText(
  instruction: string,
  options?: InstructionNormalizationOptions,
): string {
  const normalized = instruction.replace(/\r\n?/g, '\n').trim();
  if (normalized.length > 0) return normalized;
  return options?.fallbackInstruction ?? '';
}

export function buildInstructionFromParts(
  parts: string[],
  options?: InstructionNormalizationOptions,
): string {
  return normalizeInstructionText(parts.join('\n'), options);
}

export function buildCanonicalExecutionRequest(input: {
  capability: string;
  instruction: string;
  repoPath?: string;
  checkpointSessionId?: string;
  taskId?: string;
  fallbackInstruction?: string;
}): CanonicalExecutionRequest {
  const request: TaskRequest = {
    instruction: normalizeInstructionText(input.instruction, {
      fallbackInstruction: input.fallbackInstruction,
    }),
    checkpointSessionId: input.checkpointSessionId,
    repoPath: input.repoPath,
  };
  return {
    capability: input.capability,
    request,
    taskId: input.taskId,
  };
}
