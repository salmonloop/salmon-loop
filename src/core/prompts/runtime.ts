import type { ToolRegistry } from '../tools/registry.js';
import { resolvePhaseVisibleTools, type ToolVisibilityRuntime } from '../tools/tool-visibility.js';
import type { ToolSpec } from '../tools/types.js';
import { Phase } from '../types/runtime.js';

import { getPromptRegistry } from './registry.js';

export type PromptRuntime = ToolVisibilityRuntime;

function resolveToolSpecs(toolRegistry?: ToolRegistry | ToolSpec[]): ToolSpec[] {
  if (!toolRegistry) return [];
  if (Array.isArray(toolRegistry)) return toolRegistry;
  return toolRegistry.listAll();
}

function extractTargetFiles(plan: string): string | undefined {
  try {
    const parsed = JSON.parse(plan) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return undefined;
    const files = parsed.files.filter((f): f is string => typeof f === 'string');
    return files.length > 0 ? files.join(', ') : undefined;
  } catch {
    return undefined;
  }
}

export async function getExplorePrompt(
  context: string,
  instruction: string,
  lastError?: string,
): Promise<string> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.init();
  return promptRegistry.renderExplore({
    context,
    instruction,
    lastError,
  });
}

export async function getExploreSystemPrompt(runtime?: PromptRuntime): Promise<string> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.init();
  return promptRegistry.renderExploreSystemWithRuntime(runtime);
}

export async function getPlanPrompt(
  context: string,
  instruction: string,
  maxFilesChanged: number,
  lastError?: string,
): Promise<string> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.init();
  return promptRegistry.renderPlan({
    context,
    instruction,
    maxFilesChanged,
    lastError,
  });
}

export async function getPatchPrompt(
  plan: string,
  context: string,
  maxFilesChanged: number,
  maxDiffLines: number,
  lastError?: string,
): Promise<string> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.init();
  return promptRegistry.renderPatch({
    plan,
    context,
    targetFiles: extractTargetFiles(plan),
    maxFilesChanged,
    maxDiffLines,
    lastError,
  });
}

export async function getPlanSystemPrompt(
  toolRegistry?: ToolRegistry | ToolSpec[],
  runtime?: PromptRuntime,
): Promise<string> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.init();

  const promptVisibleTools = resolvePhaseVisibleTools({
    phase: Phase.PLAN,
    tools: resolveToolSpecs(toolRegistry),
    runtime,
  });

  return promptRegistry.renderPlanSystemWithTools(promptVisibleTools, runtime);
}

export async function getPatchSystemPrompt(
  toolRegistry?: ToolRegistry | ToolSpec[],
  runtime?: PromptRuntime,
): Promise<string> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.init();

  const promptVisibleTools = resolvePhaseVisibleTools({
    phase: Phase.PATCH,
    tools: resolveToolSpecs(toolRegistry),
    runtime,
  });

  return promptRegistry.renderPatchSystemWithTools(promptVisibleTools, runtime);
}
