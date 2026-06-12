import { join } from 'path';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { readFile } from '../../adapters/fs/node-fs.js';
import { AstParser } from '../../ast/parser.js';
import { extractImportSpecifiers } from '../../context/ast/import-extractor.js';
import { resolveImportCandidates } from '../../context/ast/module-resolver.js';
import { tryGetPluginRegistry } from '../../plugin/registry.js';
import { spawnCommand } from '../../runtime/process-runner.js';
import { Phase } from '../../types/runtime.js';
import { normalizePath } from '../../utils/path.js';
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
  allowedPhases: [Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.AUTOPILOT],
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
  const registry = ctx.languagePlugins ?? tryGetPluginRegistry();
  const lang = registry?.getByExtension(input.file)?.meta.id;
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

// ── code.find_references ──────────────────────────────────────────────

const MAX_SCAN_FILES = 30;
const RG_TIMEOUT_MS = 10_000;

export const codeFindReferencesSpec: Omit<ToolSpec, 'executor'> = {
  name: 'code.find_references',
  source: 'builtin',
  intent: 'SEARCH',
  description: text.tools.codeFindReferencesDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.file)],
  inputSchema: z.object({
    file: z.string().describe('Relative path to the file where the symbol is defined'),
    symbol: z.string().describe('The symbol name to find references for'),
  }),
  outputSchema: z.object({
    definition: z
      .object({
        file: z.string(),
        name: z.string(),
        location: z.any(),
      })
      .nullable(),
    references: z.array(
      z.object({
        file: z.string(),
        name: z.string(),
        location: z.any(),
      }),
    ),
    filesScanned: z.number(),
  }),
  allowedPhases: [Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.AUTOPILOT],
};

export async function executeCodeFindReferences(
  input: z.infer<typeof codeFindReferencesSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const registry = ctx.languagePlugins ?? tryGetPluginRegistry();

  // 1. Parse the target file to find the definition
  const targetPath = join(repoRoot, input.file);
  const targetCode = await readFile(targetPath, 'utf-8');
  const targetLang = registry?.getByExtension(input.file)?.meta.id;

  let definition: { file: string; name: string; location: any } | null = null;
  if (targetLang) {
    const tree = await AstParser.parse(targetCode, targetLang);
    const defs = await AstParser.identifyDefinitions(tree, targetLang);
    const match = defs.find((d) => d.name === input.symbol);
    if (match) {
      definition = { file: input.file, name: match.name, location: match.location };
    }
  }

  // 2. Collect candidate files via ripgrep (fast pre-filter)
  const candidates = await rgFindCandidates(repoRoot, input.symbol, input.file);

  // 3. Also collect import neighbors of the target file
  const importNeighbors = await resolveImportNeighbors(input.file, targetCode, repoRoot);
  for (const neighbor of importNeighbors) {
    if (!candidates.includes(neighbor) && neighbor !== input.file) {
      candidates.push(neighbor);
    }
  }

  // 4. Cap the number of files to scan
  const toScan = candidates.slice(0, MAX_SCAN_FILES);

  // 5. Parse each candidate and find references
  const references: Array<{ file: string; name: string; location: any }> = [];
  for (const file of toScan) {
    try {
      const lang = registry?.getByExtension(file)?.meta.id;
      if (!lang) continue;

      const fullPath = join(repoRoot, file);
      const code = await readFile(fullPath, 'utf-8');
      const tree = await AstParser.parse(code, lang);
      const refs = await AstParser.identifyReferences(tree, lang);

      for (const ref of refs) {
        if (ref.name === input.symbol) {
          references.push({ file, name: ref.name, location: ref.location });
        }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return {
    definition,
    references,
    filesScanned: toScan.length,
  };
}

/**
 * Use ripgrep to find files that mention the symbol (fast pre-filter).
 * Returns repo-relative paths, excluding the target file itself.
 */
async function rgFindCandidates(
  repoRoot: string,
  symbol: string,
  excludeFile: string,
): Promise<string[]> {
  let stdout = '';
  try {
    const result = await spawnCommand({
      command: 'rg',
      args: ['--files-with-matches', '--fixed-strings', '--max-count', '1', symbol, '.'],
      cwd: repoRoot,
      env: process.env,
      timeoutMs: RG_TIMEOUT_MS,
      onStdoutChunk: (chunk) => {
        stdout += Buffer.from(chunk).toString();
      },
      onStderrChunk: () => {},
    });

    if (result.error || result.timedOut || (result.code !== 0 && result.code !== 1)) {
      return [];
    }

    const normalizedExclude = normalizePath(excludeFile).replace(/^(\.\/|\/)+/, '');
    return stdout
      .split('\n')
      .map((line) => normalizePath(line.trim()).replace(/^(\.\/|\/)+/, ''))
      .filter((f) => f && f !== normalizedExclude);
  } catch {
    return [];
  }
}

/**
 * Resolve import neighbors of a file — files that the target imports.
 */
async function resolveImportNeighbors(
  targetFile: string,
  targetCode: string,
  _repoRoot: string,
): Promise<string[]> {
  const specifiers = extractImportSpecifiers(targetCode);
  const neighbors: string[] = [];

  for (const spec of specifiers) {
    if (!spec.startsWith('.')) continue;
    const candidates = resolveImportCandidates({ currentFile: targetFile, specifier: spec });
    for (const candidate of candidates) {
      const normalized = normalizePath(candidate).replace(/^(\.\/|\/)+/, '');
      if (normalized && !neighbors.includes(normalized)) {
        neighbors.push(normalized);
      }
    }
  }

  return neighbors;
}
