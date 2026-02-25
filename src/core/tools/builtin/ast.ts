import { join } from 'path';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { readFile } from '../../adapters/fs/node-fs.js';
import { AstParser } from '../../ast/parser.js';
import { pluginRegistry } from '../../plugin/registry.js';
import { Phase } from '../../types/index.js';
import { pathPrefixResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const astDefsRefsSpec: Omit<ToolSpec, 'executor'> = {
  name: 'code.ast',
  source: 'builtin',
  intent: 'SEARCH',
  description: text.tools.codeAstDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.file)],
  inputSchema: z.object({
    file: z.string().describe('Relative path to the file to analyze'),
    symbol: z.string().optional().describe('Filter by specific symbol name'),
  }),
  outputSchema: z.object({
    definitions: z.array(
      z.object({
        name: z.string(),
        location: z.any(),
      }),
    ),
    references: z.array(
      z.object({
        name: z.string(),
        location: z.any(),
      }),
    ),
  }),
  allowedPhases: [Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN],
};

/**
 * Builtin tool to query AST definitions and references
 */
export async function executeAstDefsRefs(
  input: z.infer<typeof astDefsRefsSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const fullPath = join(ctx.worktreeRoot || ctx.repoRoot, input.file);
  const code = await readFile(fullPath, 'utf-8');
  const lang = pluginRegistry.getByExtension(input.file)?.meta.id;
  if (!lang) {
    return { definitions: [], references: [] };
  }

  const tree = await AstParser.parse(code, lang);
  try {
    let defs = await AstParser.identifyDefinitions(tree, lang);
    let refs = await AstParser.identifyReferences(tree, lang);

    if (input.symbol) {
      defs = defs.filter((d) => d.name === input.symbol);
      refs = refs.filter((r) => r.name === input.symbol);
    }

    return {
      definitions: defs.map((d) => ({ name: d.name, location: d.location })),
      references: refs.map((r) => ({ name: r.name, location: r.location })),
    };
  } finally {
    // Tree deletion is handled by AstParser's cache cleanup logic or explicit delete if needed
  }
}
