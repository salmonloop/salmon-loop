import { promptRegistry } from './prompts/registry.js';
import type { ToolRegistry } from './tools/registry.js';

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

export async function getPlanPrompt(
  context: string,
  instruction: string,
  maxFilesChanged: number,
  lastError?: string,
): Promise<string> {
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

export async function getPlanSystemPrompt(toolRegistry?: ToolRegistry): Promise<string> {
  await promptRegistry.init();
  if (toolRegistry) {
    promptRegistry.setTools(toolRegistry.listAll());
  }
  return promptRegistry.renderPlanSystem();
}

export async function getPatchSystemPrompt(toolRegistry?: ToolRegistry): Promise<string> {
  await promptRegistry.init();
  if (toolRegistry) {
    promptRegistry.setTools(toolRegistry.listAll());
  }
  return promptRegistry.renderPatchSystem();
}
