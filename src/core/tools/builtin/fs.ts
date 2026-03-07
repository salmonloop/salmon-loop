import { isAbsolute, relative, resolve } from 'path';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { readFile, readdir, stat } from '../../adapters/fs/node-fs.js';
import { Phase } from '../../types/runtime.js';
import { pathPrefixResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

const FsListEntryType = z.enum(['file', 'dir', 'symlink', 'other']);

const fsListInputSchema = z.preprocess(
  (raw) => {
    if (typeof raw === 'string') {
      return { path: raw };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const input = raw as Record<string, unknown>;
    const includeHidden = input.includeHidden;
    if (typeof includeHidden === 'string') {
      const normalized = includeHidden.trim().toLowerCase();
      if (normalized === 'true') input.includeHidden = true;
      if (normalized === 'false') input.includeHidden = false;
      if (normalized === '1') input.includeHidden = true;
      if (normalized === '0') input.includeHidden = false;
    }
    if (typeof includeHidden === 'number') {
      if (includeHidden === 1) input.includeHidden = true;
      if (includeHidden === 0) input.includeHidden = false;
    }

    if (typeof input.path === 'string') return input;

    const alias = input.dir ?? input.directory ?? input.folder ?? input.cwd;
    if (typeof alias !== 'string') return input;

    return {
      ...input,
      path: alias,
    };
  },
  z.object({
    path: z
      .string()
      .default('.')
      .describe('Relative directory path to list from the repository root (default: ".")'),
    includeHidden: z
      .boolean()
      .default(false)
      .describe('Whether to include entries that start with "." (hidden files)'),
    maxEntries: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(200)
      .describe('Maximum number of entries to return'),
  }),
);

const fsReadInputSchema = z.preprocess(
  (raw) => {
    if (typeof raw === 'string') {
      return { file: raw };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const input = raw as Record<string, unknown>;
    if (typeof input.file === 'string') return input;

    const alias = input.path ?? input.file_path ?? input.filePath;
    if (typeof alias !== 'string') return input;

    return {
      ...input,
      file: alias,
    };
  },
  z.object({
    file: z.string().describe('Relative path to the file from the repository root'),
  }),
);

/**
 * Spec for the fs.read tool.
 */
export const fsReadFileSpec: Omit<ToolSpec, 'executor'> = {
  name: 'fs.read',
  source: 'builtin',
  intent: 'READ',
  description: `${text.tools.fsReadDescription} IMPORTANT: The file parameter must be a relative path (e.g., "src/main.ts"). Do NOT use absolute paths or paths with "..".`,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.file)],
  inputSchema: fsReadInputSchema,
  outputSchema: z.object({ content: z.string(), size: z.number() }),
  allowedPhases: [
    Phase.SLASH,
    Phase.CONTEXT,
    Phase.EXPLORE,
    Phase.PLAN,
    Phase.PATCH,
    Phase.VERIFY,
    Phase.SHRINK,
  ],
  examples: [
    {
      description: 'Read a source file',
      input: { file: 'src/main.ts' },
      output: { content: '<file content>', size: 1234 },
    },
    {
      description: 'Read configuration file',
      input: { file: 'package.json' },
      output: { content: '<file content>', size: 1234 },
    },
    {
      description: 'Read README documentation',
      input: { file: 'README.md' },
      output: { content: '<file content>', size: 6789 },
    },
  ],
};

/**
 * Spec for the code.read tool (alias of fs.read).
 */
export const codeReadSpec: Omit<ToolSpec, 'executor'> = {
  ...fsReadFileSpec,
  name: 'code.read',
  description: text.tools.codeReadDescription,
};

/**
 * Spec for the fs.list tool.
 */
export const fsListSpec: Omit<ToolSpec, 'executor'> = {
  name: 'fs.list',
  source: 'builtin',
  intent: 'LIST',
  description: text.tools.fsListDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (input, ctx) => {
    const prefix =
      input.path === '.' || input.path === '' ? '.' : `${input.path.replace(/\/+$/, '')}/`;
    return [pathPrefixResource(ctx, prefix)];
  },
  inputSchema: fsListInputSchema,
  outputSchema: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        type: FsListEntryType,
      }),
    ),
    truncated: z.boolean(),
    totalEntries: z.number().int(),
  }),
  allowedPhases: [
    Phase.SLASH,
    Phase.CONTEXT,
    Phase.EXPLORE,
    Phase.PLAN,
    Phase.PATCH,
    Phase.VERIFY,
    Phase.SHRINK,
  ],
};

function toRepoRelativeChildPath(dir: string, name: string): string {
  const normalizedDir = String(dir || '.')
    .replace(/\\/g, '/')
    .trim();
  const base = normalizedDir === '.' ? '' : normalizedDir.replace(/^\.\/+/, '').replace(/\/+$/, '');
  return base ? `${base}/${name}` : name;
}

/**
 * Implementation of the fs.list tool.
 */
export async function executeFsList(
  input: z.infer<typeof fsListSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { path: dir, includeHidden, maxEntries } = input;

  if (isAbsolute(dir)) {
    throw new Error('Access denied: Path is outside of repository root.');
  }

  const absoluteRoot = resolve(ctx.repoRoot);
  const absolutePath = resolve(absoluteRoot, dir);
  const relPath = relative(absoluteRoot, absolutePath);

  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error('Access denied: Path is outside of repository root.');
  }

  try {
    const dirents = await readdir(absolutePath, { withFileTypes: true });
    const visible = includeHidden ? dirents : dirents.filter((d) => !d.name.startsWith('.'));

    const entries = visible
      .map((d) => {
        const type = d.isDirectory()
          ? 'dir'
          : d.isFile()
            ? 'file'
            : d.isSymbolicLink()
              ? 'symlink'
              : 'other';
        return {
          name: d.name,
          path: toRepoRelativeChildPath(dir, d.name),
          type,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    const totalEntries = entries.length;
    const sliced = entries.slice(0, maxEntries);

    return {
      entries: sliced,
      truncated: sliced.length < totalEntries,
      totalEntries,
    };
  } catch (e: unknown) {
    throw new Error(
      `Failed to list directory ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

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
  } catch (e: unknown) {
    throw new Error(`Failed to read file ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
