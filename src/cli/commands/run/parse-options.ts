import { resolve } from 'path';

import type { Command } from 'commander';

import type { RunCommandParsedOptions } from './types.js';

function splitToolRules(raw: unknown): string[] {
  const parts: string[] = [];
  const push = (s: unknown) => {
    if (typeof s !== 'string') return;
    for (const piece of s.split(',')) {
      const trimmed = piece.trim();
      if (trimmed) parts.push(trimmed);
    }
  };
  if (Array.isArray(raw)) {
    for (const v of raw) push(v);
    return parts;
  }
  push(raw);
  return parts;
}

export function parseRunCommandOptions(command: Command): RunCommandParsedOptions & {
  allowedToolRules: string[];
  disallowedToolRules: string[];
} {
  const allOptions = command.optsWithGlobals();
  const repoPath = resolve(allOptions.repo || process.cwd());

  const continueSession = Boolean((allOptions as any).continue);
  const resumeSessionId =
    typeof (allOptions as any).resume === 'string'
      ? ((allOptions as any).resume as string)
      : undefined;
  const printInstruction =
    typeof (allOptions as any).print === 'string'
      ? ((allOptions as any).print as string)
      : undefined;
  const explicitInstruction =
    typeof allOptions.instruction === 'string' ? (allOptions.instruction as string) : undefined;

  const jsonSchemaSpec =
    typeof (allOptions as any).jsonSchema === 'string'
      ? ((allOptions as any).jsonSchema as string)
      : undefined;

  const rawOutputFormat = String(allOptions.outputFormat || 'text');
  const rawOutputProfile =
    typeof (allOptions as any).outputProfile === 'string'
      ? String((allOptions as any).outputProfile)
      : undefined;
  const outputProfileForStreamJson = rawOutputProfile ?? 'native';

  const headlessIncludeToolInput = Boolean((allOptions as any).headlessIncludeToolInput);
  const headlessIncludeToolOutput = Boolean((allOptions as any).headlessIncludeToolOutput);
  const headlessIncludeAuthorizationDecisions = Boolean(
    (allOptions as any).headlessIncludeAuthorizationDecisions,
  );
  const allowOutsideCacheRoot = Boolean((allOptions as any).allowOutsideCacheRoot);

  const instruction = explicitInstruction ?? printInstruction;

  const allowedToolRules = splitToolRules(allOptions.allowedTools);
  const disallowedToolRules = splitToolRules(allOptions.disallowedTools);

  return {
    allOptions,
    repoPath,
    continueSession,
    resumeSessionId,
    printInstruction,
    explicitInstruction,
    instruction,
    jsonSchemaSpec,
    rawOutputFormat,
    rawOutputProfile,
    outputProfileForStreamJson,
    headlessIncludeToolInput,
    headlessIncludeToolOutput,
    headlessIncludeAuthorizationDecisions,
    allowOutsideCacheRoot,
    allowedToolRules,
    disallowedToolRules,
  };
}
