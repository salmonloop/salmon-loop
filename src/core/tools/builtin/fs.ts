import { readFile, stat } from 'fs/promises';
import { isAbsolute, relative, resolve } from 'path';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { Phase } from '../../types.js';
import { pathPrefixResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

/**
 * Spec for the fs.read tool.
 */
export const fsReadFileSpec: Omit<ToolSpec, 'executor'> = {
  name: 'fs.read',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.fsReadDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.file)],
  inputSchema: z.object({
    file: z.string().describe('Relative path to the file from the repository root'),
  }),
  outputSchema: z.object({
    content: z.string(),
    size: z.number(),
  }),
  allowedPhases: [
    Phase.CONTEXT,
    Phase.EXPLORE,
    Phase.PLAN,
    Phase.PATCH,
    Phase.VERIFY,
    Phase.SHRINK,
  ],
};

/**
 * Implementation of the fs.read tool.
 */
export async function executeFsReadFile(
  input: z.infer<typeof fsReadFileSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { file } = input;

  if (isAbsolute(file)) {
    throw new Error('Access denied: Path is outside of repository root.');
  }

  // CRITICAL SAFETY: Path traversal check using relative path resolution
  // We resolve to absolute paths to handle '.' and '..' correctly
  const absoluteRoot = resolve(ctx.repoRoot);
  // use resolve instead of join to handle absolute paths in input correctly
  const absolutePath = resolve(absoluteRoot, file);
  const relPath = relative(absoluteRoot, absolutePath);

  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error('Access denied: Path is outside of repository root.');
  }

  try {
    const fileStat = await stat(absolutePath);
    const content = await readFile(absolutePath, 'utf-8');

    return {
      content,
      size: fileStat.size,
    };
  } catch (e: any) {
    throw new Error(`Failed to read file ${file}: ${e.message}`);
  }
}
