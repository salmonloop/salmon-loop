import type { Command } from 'commander';

import { getString } from '../../../core/utils/serialize.js';
import { resolveRepoPath } from '../../utils/resolve-cli-config.js';

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
  const allOptions = command.optsWithGlobals() as Record<string, unknown>;
  const repoPath = resolveRepoPath({
    repo: getString(allOptions, 'repo') ?? undefined,
    cwd: process.cwd(),
  });

  const continueSession = Boolean(allOptions.continue);
  const resumeSessionId = getString(allOptions, 'resume') ?? undefined;
  const printInstruction = getString(allOptions, 'print') ?? undefined;
  const explicitInstruction = getString(allOptions, 'instruction') ?? undefined;

  const jsonSchemaSpec = getString(allOptions, 'jsonSchema') ?? undefined;

  const rawOutputFormat = String(allOptions.outputFormat || 'text');
  const rawOutputProfile = getString(allOptions, 'outputProfile') ?? undefined;
  const outputProfileForStreamJson = rawOutputProfile ?? 'native';

  const headlessIncludeToolInput = Boolean(allOptions.headlessIncludeToolInput);
  const headlessIncludeToolOutput = Boolean(allOptions.headlessIncludeToolOutput);
  const headlessIncludeAuthorizationDecisions = Boolean(
    allOptions.headlessIncludeAuthorizationDecisions,
  );
  const allowOutsideCacheRoot = Boolean(allOptions.allowOutsideCacheRoot);
  const exportPatchPath = getString(allOptions, 'exportPatch') ?? undefined;
  const sweBenchInstanceId = getString(allOptions, 'sweBenchInstanceId') ?? undefined;
  const sweBenchModelName = getString(allOptions, 'sweBenchModelName') ?? undefined;
  const sweBenchPredictionsPath = getString(allOptions, 'sweBenchPredictions') ?? undefined;

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
    exportPatchPath,
    sweBenchInstanceId,
    sweBenchModelName,
    sweBenchPredictionsPath,
    allowedToolRules,
    disallowedToolRules,
  };
}
