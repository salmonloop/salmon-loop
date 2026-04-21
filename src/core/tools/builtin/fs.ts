import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';
import { isAbsolute, relative, resolve } from 'path';

import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { AtomicFileWriter } from '../../adapters/fs/atomic-file-writer.js';
import { mkdir, readFile, readdir, stat } from '../../adapters/fs/node-fs.js';
import { Phase } from '../../types/runtime.js';
import { normalizeRepoRelativePath } from '../../utils/path.js';
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
    Phase.AUTOPILOT,
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
    Phase.AUTOPILOT,
    Phase.PATCH,
    Phase.VERIFY,
    Phase.SHRINK,
  ],
};

/**
 * Spec for the fs.list_directory tool.
 */
export const fsListDirectorySpec: Omit<ToolSpec, 'executor'> = {
  ...fsListSpec,
  name: 'fs.list_directory',
  description: text.tools.fsListDirectoryDescription,
};

/**
 * Spec for the fs.list_files tool.
 */
export const fsListFilesSpec: Omit<ToolSpec, 'executor'> = {
  ...fsListSpec,
  name: 'fs.list_files',
  description: text.tools.fsListFilesDescription,
};

function toRepoRelativeChildPath(dir: string, name: string): string {
  const normalizedDir = String(dir || '.')
    .replace(/\\/g, '/')
    .trim();
  const base = normalizedDir === '.' ? '' : normalizedDir.replace(/^\.\/+/, '').replace(/\/+$/, '');
  return base ? `${base}/${name}` : name;
}

function assertNotReservedRepoPrefix(relPath: string): void {
  const normalized = normalizeRepoRelativePath(relPath);
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    throw new Error(text.errors.reservedPathPrefix('.git/'));
  }
  if (normalized === '.salmonloop' || normalized.startsWith('.salmonloop/')) {
    throw new Error(text.errors.reservedPathPrefix('.salmonloop/'));
  }
}

function resolveRepoRelativePath(repoRoot: string, relPath: string): { absolutePath: string } {
  if (isAbsolute(relPath)) {
    throw new Error(text.errors.pathOutsideRepo);
  }

  assertNotReservedRepoPrefix(relPath);

  const absoluteRoot = resolve(repoRoot);
  const absolutePath = resolve(absoluteRoot, relPath);
  const computedRelPath = relative(absoluteRoot, absolutePath);

  if (computedRelPath.startsWith('..') || isAbsolute(computedRelPath)) {
    throw new Error(text.errors.pathOutsideRepo);
  }

  return { absolutePath };
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
    throw new Error(text.errors.pathOutsideRepo);
  }

  const absoluteRoot = resolve(ctx.repoRoot);
  const absolutePath = resolve(absoluteRoot, dir);
  const relPath = relative(absoluteRoot, absolutePath);

  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error(text.errors.pathOutsideRepo);
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
 * Implementation of the fs.list_directory tool.
 */
export async function executeFsListDirectory(
  input: z.infer<typeof fsListDirectorySpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  return executeFsList(input as any, ctx);
}

/**
 * Implementation of the fs.list_files tool.
 */
export async function executeFsListFiles(
  input: z.infer<typeof fsListFilesSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { path: dir, includeHidden, maxEntries } = input;

  if (isAbsolute(dir)) {
    throw new Error(text.errors.pathOutsideRepo);
  }

  const absoluteRoot = resolve(ctx.repoRoot);
  const absolutePath = resolve(absoluteRoot, dir);
  const relPath = relative(absoluteRoot, absolutePath);

  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error(text.errors.pathOutsideRepo);
  }

  try {
    const dirents = await readdir(absolutePath, { withFileTypes: true });
    const visible = includeHidden ? dirents : dirents.filter((d) => !d.name.startsWith('.'));

    const fileEntries = visible
      .filter((d) => d.isFile())
      .map((d) => ({
        name: d.name,
        path: toRepoRelativeChildPath(dir, d.name),
        type: 'file' as const,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const totalEntries = fileEntries.length;
    const sliced = fileEntries.slice(0, maxEntries);

    return {
      entries: sliced,
      truncated: sliced.length < totalEntries,
      totalEntries,
    };
  } catch (e: unknown) {
    throw new Error(
      `Failed to list files in directory ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const fsWriteFileInputSchema = z.object({
  file: z.string().describe('Relative path to the file from the repository root'),
  content: z.string().describe('UTF-8 text content to write'),
  encoding: z
    .enum(['utf-8'])
    .optional()
    .describe('Text encoding (only utf-8 is supported; default: utf-8)'),
});

/**
 * Spec for the fs.write_file tool.
 */
export const fsWriteFileSpec: Omit<ToolSpec, 'executor'> = {
  name: 'fs.write_file',
  source: 'builtin',
  intent: 'WRITE',
  description: text.tools.fsWriteFileDescription,
  riskLevel: 'high',
  sideEffects: ['fs_write'],
  concurrency: 'serial_only',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.file)],
  allowedPhases: [Phase.SLASH, Phase.AUTOPILOT],
  inputSchema: fsWriteFileInputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    path: z.string(),
    bytesWritten: z.number().int().nonnegative(),
  }),
  summarizeArgsForAuthorization: async (args) => {
    const encoding = (args as any)?.encoding || 'utf-8';
    const content = String((args as any)?.content ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
    return JSON.stringify({
      file: (args as any)?.file,
      encoding,
      bytes,
      sha256,
    });
  },
};

export async function executeFsWriteFile(
  input: z.infer<typeof fsWriteFileSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  if (ctx.dryRun) {
    return { ok: true, path: input.file, bytesWritten: 0 };
  }

  const { absolutePath } = resolveRepoRelativePath(ctx.repoRoot, input.file);
  const writer = new AtomicFileWriter();
  const contentBytes = Buffer.from(input.content, 'utf8');

  await writer.writeAtomic(absolutePath, contentBytes);

  return {
    ok: true,
    path: input.file,
    bytesWritten: contentBytes.length,
  };
}

const fsCreateDirectoryInputSchema = z.preprocess(
  (raw) => {
    if (typeof raw === 'string') return { path: raw };
    return raw;
  },
  z.object({
    path: z.string().describe('Relative directory path to create from the repository root'),
    recursive: z.boolean().default(true).describe('Whether to create parent directories'),
  }),
);

/**
 * Spec for the fs.create_directory tool.
 */
export const fsCreateDirectorySpec: Omit<ToolSpec, 'executor'> = {
  name: 'fs.create_directory',
  source: 'builtin',
  intent: 'WRITE',
  description: text.tools.fsCreateDirectoryDescription,
  riskLevel: 'high',
  sideEffects: ['fs_write'],
  concurrency: 'serial_only',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.path)],
  allowedPhases: [Phase.SLASH, Phase.AUTOPILOT],
  inputSchema: fsCreateDirectoryInputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    path: z.string(),
  }),
  summarizeArgsForAuthorization: async (args) =>
    JSON.stringify({ path: (args as any)?.path, recursive: (args as any)?.recursive }),
};

export async function executeFsCreateDirectory(
  input: z.infer<typeof fsCreateDirectorySpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  if (ctx.dryRun) {
    return { ok: true, path: input.path };
  }

  const { absolutePath } = resolveRepoRelativePath(ctx.repoRoot, input.path);
  await mkdir(absolutePath, { recursive: input.recursive });

  return { ok: true, path: input.path };
}

const fsDeleteFileInputSchema = z.preprocess(
  (raw) => {
    if (typeof raw === 'string') return { file: raw };
    return raw;
  },
  z.object({
    file: z.string().describe('Relative path to the file from the repository root'),
    missingOk: z.boolean().default(true).describe('Whether missing files are treated as success'),
  }),
);

/**
 * Spec for the fs.delete_file tool.
 */
export const fsDeleteFileSpec: Omit<ToolSpec, 'executor'> = {
  name: 'fs.delete_file',
  source: 'builtin',
  intent: 'WRITE',
  description: text.tools.fsDeleteFileDescription,
  riskLevel: 'high',
  sideEffects: ['fs_write'],
  concurrency: 'serial_only',
  computeResources: (input, ctx) => [pathPrefixResource(ctx, input.file)],
  allowedPhases: [Phase.SLASH, Phase.AUTOPILOT],
  inputSchema: fsDeleteFileInputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    path: z.string(),
    deleted: z.boolean(),
  }),
  summarizeArgsForAuthorization: async (args) =>
    JSON.stringify({ file: (args as any)?.file, missingOk: (args as any)?.missingOk }),
};

export async function executeFsDeleteFile(
  input: z.infer<typeof fsDeleteFileSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  if (ctx.dryRun) {
    return { ok: true, path: input.file, deleted: false };
  }

  const { absolutePath } = resolveRepoRelativePath(ctx.repoRoot, input.file);

  let exists = true;
  try {
    await stat(absolutePath);
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as any).code : undefined;
    if (code === 'ENOENT') exists = false;
    else throw e;
  }

  if (!exists) {
    if (input.missingOk) {
      return { ok: true, path: input.file, deleted: false };
    }
    throw new Error(text.errors.pathNotFound(input.file));
  }

  const writer = new AtomicFileWriter();
  await writer.deleteAtomic(absolutePath);

  return { ok: true, path: input.file, deleted: true };
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
    throw new Error(text.errors.pathOutsideRepo);
  }

  // CRITICAL SAFETY: Path traversal check using relative path resolution
  // We resolve to absolute paths to handle '.' and '..' correctly
  const absoluteRoot = resolve(ctx.repoRoot);
  // use resolve instead of join to handle absolute paths in input correctly
  const absolutePath = resolve(absoluteRoot, file);
  const relPath = relative(absoluteRoot, absolutePath);

  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error(text.errors.pathOutsideRepo);
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
