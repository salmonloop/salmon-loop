import { createHash } from 'crypto';
import path from 'path';

import { z } from 'zod';

import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import {
  buildBenchmarkPatchArtifact,
  type BenchmarkPatchArtifact,
} from '../../benchmark/patch-artifact.js';
import {
  buildSweBenchPrediction,
  encodeSweBenchPredictionJsonl,
  parseSweBenchInstance,
} from '../../benchmark/swe-bench.js';
import { normalizeDiff, validateDiff } from '../../patch/diff.js';
import { Phase } from '../../types/runtime.js';
import {
  isCanonicalPathWithinDirectory,
  isPathWithinDirectory,
  normalizeRepoRelativePath,
} from '../../utils/path.js';
import { repoResource } from '../parallel/resource-helpers.js';
import type { ToolSpec, ToolRuntimeCtx } from '../types.js';

const patchInputSchema = z.object({
  patch: z
    .string()
    .optional()
    .describe('Unified diff to check. Defaults to current workspace diff.'),
});

const patchCheckOutputSchema = z.object({
  ok: z.boolean(),
  changedFiles: z.array(z.string()),
  fileCount: z.number(),
  lineCount: z.number(),
  error: z.string().optional(),
});

export const gitDiffCheckSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.diff_check',
  source: 'builtin',
  intent: 'INFRA',
  description: 'Validate that a unified diff is structurally valid and within patch limits.',
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: patchInputSchema,
  outputSchema: patchCheckOutputSchema,
  allowedPhases: [Phase.VERIFY],
};

export const gitApplyCheckSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.apply_check',
  source: 'builtin',
  intent: 'INFRA',
  description: 'Run git apply --check against a unified diff without mutating the workspace.',
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: patchInputSchema.extend({
    ignoreWhitespace: z.boolean().default(false),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    exitCode: z.number().nullable(),
    output: z.string(),
  }),
  allowedPhases: [Phase.VERIFY],
};

const benchmarkReportInputSchema = z.object({
  patch: z
    .string()
    .optional()
    .describe('Unified diff to summarize. Defaults to current workspace diff.'),
});

const benchmarkReportOutputSchema = z.object({
  provider: z.literal('local'),
  patch: z.object({
    sha256: z.string(),
    bytes: z.number(),
    changedFiles: z.array(z.string()),
    isEmpty: z.boolean(),
  }),
});

export const benchmarkReportSpec: Omit<ToolSpec, 'executor'> = {
  name: 'benchmark.report',
  source: 'builtin',
  intent: 'REPORT',
  description: 'Create a local benchmark report for the current workspace patch.',
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: benchmarkReportInputSchema,
  outputSchema: benchmarkReportOutputSchema,
  allowedPhases: [Phase.VERIFY],
};

export const sweBenchLoadInstanceSpec: Omit<ToolSpec, 'executor'> = {
  name: 'swebench.load_instance',
  source: 'builtin',
  intent: 'READ',
  description: 'Load a local SWE-bench instance JSON file without network access.',
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  inputSchema: z.object({
    file: z.string().describe('Repo-relative path to a SWE-bench instance JSON file'),
  }),
  outputSchema: z
    .object({
      instance_id: z.string(),
      repo: z.string().optional(),
      base_commit: z.string().optional(),
      problem_statement: z.string().optional(),
    })
    .passthrough(),
  allowedPhases: [Phase.VERIFY],
};

const swePredictionInputSchema = z.object({
  instanceId: z.string().min(1).describe('SWE-bench instance_id'),
  modelNameOrPath: z.string().min(1).describe('SWE-bench model_name_or_path'),
  patch: z
    .string()
    .optional()
    .describe('Unified diff to encode. Defaults to current workspace diff.'),
});

const swePredictionOutputSchema = z.object({
  prediction: z.object({
    instance_id: z.string(),
    model_name_or_path: z.string(),
    model_patch: z.string(),
  }),
  jsonl: z.string(),
});

export const sweBenchWritePredictionSpec: Omit<ToolSpec, 'executor'> = {
  name: 'swebench.write_prediction',
  source: 'builtin',
  intent: 'REPORT',
  description: 'Encode a SWE-bench prediction JSONL record without writing to disk.',
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: swePredictionInputSchema,
  outputSchema: swePredictionOutputSchema,
  allowedPhases: [Phase.VERIFY],
};

export const sweBenchSubmitPredictionsSpec: Omit<ToolSpec, 'executor'> = {
  name: 'swebench.submit_predictions',
  source: 'builtin',
  intent: 'REPORT',
  description: 'Append a SWE-bench prediction JSONL record to a local repo-contained file.',
  riskLevel: 'medium',
  sideEffects: ['fs_write', 'git_read'],
  concurrency: 'serial_only',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: swePredictionInputSchema.extend({
    predictionsFile: z
      .string()
      .default('predictions.jsonl')
      .describe('Repo-relative JSONL file to append the prediction to'),
  }),
  outputSchema: z.object({
    predictionsFile: z.string(),
    appended: z.boolean(),
    prediction: swePredictionOutputSchema.shape.prediction,
  }),
  allowedPhases: [Phase.VERIFY],
};

export const sweBenchGetReportSpec: Omit<ToolSpec, 'executor'> = {
  name: 'swebench.get_report',
  source: 'builtin',
  intent: 'READ',
  description: 'Read a local SWE-bench report JSON file without network access.',
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  inputSchema: z.object({
    file: z.string().describe('Repo-relative path to a SWE-bench report JSON file'),
  }),
  outputSchema: z.object({
    report: z.record(z.string(), z.unknown()),
  }),
  allowedPhases: [Phase.VERIFY],
};

type ResolvePatchOptions = {
  excludePaths?: readonly string[];
};

async function resolvePatch(
  ctx: ToolRuntimeCtx,
  patch?: string,
  options: ResolvePatchOptions = {},
): Promise<BenchmarkPatchArtifact> {
  if (patch !== undefined) {
    if (patch.trim().length === 0) {
      return {
        patch: '',
        bytes: 0,
        sha256: createHash('sha256').update('', 'utf8').digest('hex'),
        changedFiles: [],
        isEmpty: true,
      };
    }
    const normalizedPatch = normalizeDiff(patch);
    const meta = validateDiff(normalizedPatch);
    const bytes = Buffer.byteLength(normalizedPatch, 'utf8');
    const sha256 = createHash('sha256').update(normalizedPatch, 'utf8').digest('hex');
    return {
      patch: normalizedPatch,
      bytes,
      sha256,
      changedFiles: meta.changedFiles,
      isEmpty: normalizedPatch.length === 0,
    };
  }

  return buildBenchmarkPatchArtifact({
    repoPath: ctx.worktreeRoot || ctx.repoRoot,
    excludePaths: options.excludePaths,
  });
}

function resolveRepoFile(
  ctx: ToolRuntimeCtx,
  file: string,
): { absolutePath: string; relativePath: string } {
  const root = ctx.worktreeRoot || ctx.repoRoot;
  if (path.isAbsolute(file)) {
    throw new Error(`Expected a repo-relative path: ${file}`);
  }
  assertNotReservedRepoPrefix(file);
  const absolutePath = path.resolve(root, file);
  if (!isPathWithinDirectory(root, absolutePath, { allowEqual: false })) {
    throw new Error(`Refusing to access path outside repository: ${file}`);
  }
  const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
  assertNotReservedRepoPrefix(relativePath);
  return { absolutePath, relativePath };
}

function assertNotReservedRepoPrefix(file: string): void {
  const normalized = normalizeRepoRelativePath(file);
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    throw new Error('Access denied: Reserved path prefix: .git/');
  }
  if (normalized === '.salmonloop' || normalized.startsWith('.salmonloop/')) {
    throw new Error('Access denied: Reserved path prefix: .salmonloop/');
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT',
  );
}

async function assertNoSymlinkPathComponents(root: string, absolutePath: string): Promise<void> {
  const adapter = new FileAdapter();
  const resolvedRoot = path.resolve(root);
  let cursor = absolutePath;

  while (isPathWithinDirectory(resolvedRoot, cursor, { allowEqual: false })) {
    try {
      const stats = await adapter.lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to follow symlink path component: ${path.relative(resolvedRoot, cursor)}`,
        );
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    cursor = path.dirname(cursor);
  }
}

async function assertCanonicalRepoContainment(root: string, absolutePath: string): Promise<void> {
  const adapter = new FileAdapter();
  const realRoot = await adapter.realpath(root);
  let cursor = absolutePath;

  while (true) {
    try {
      const realCursor = await adapter.realpath(cursor);
      if (!isCanonicalPathWithinDirectory(realRoot, realCursor, { allowEqual: true })) {
        throw new Error(
          `Refusing to access path outside repository: ${path.relative(root, absolutePath)}`,
        );
      }
      return;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

async function resolveSafeRepoFile(
  ctx: ToolRuntimeCtx,
  file: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const resolved = resolveRepoFile(ctx, file);
  const root = ctx.worktreeRoot || ctx.repoRoot;
  await assertNoSymlinkPathComponents(root, resolved.absolutePath);
  await assertCanonicalRepoContainment(root, resolved.absolutePath);
  return resolved;
}

export async function executeGitDiffCheck(
  input: z.infer<typeof gitDiffCheckSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  try {
    const artifact = await resolvePatch(ctx, input.patch);
    if (artifact.isEmpty) {
      return { ok: false, changedFiles: [], fileCount: 0, lineCount: 0, error: 'Patch is empty.' };
    }
    const meta = validateDiff(artifact.patch);
    return {
      ok: true,
      changedFiles: meta.changedFiles,
      fileCount: meta.fileCount,
      lineCount: meta.lineCount,
    };
  } catch (error) {
    return {
      ok: false,
      changedFiles: [],
      fileCount: 0,
      lineCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeGitApplyCheck(
  input: z.infer<typeof gitApplyCheckSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const artifact = await resolvePatch(ctx, input.patch);
  if (artifact.isEmpty) {
    return { ok: false, exitCode: null, output: 'Patch is empty.' };
  }
  const git = new GitAdapter(ctx.worktreeRoot || ctx.repoRoot);
  return git.checkPatchApplyability(artifact.patch, {
    ignoreWhitespace: input.ignoreWhitespace,
    env: ctx.env,
  });
}

export async function executeBenchmarkReport(
  input: z.infer<typeof benchmarkReportSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const artifact = await resolvePatch(ctx, input.patch);
  return {
    provider: 'local' as const,
    patch: {
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      changedFiles: artifact.changedFiles,
      isEmpty: artifact.isEmpty,
    },
  };
}

export async function executeSweBenchLoadInstance(
  input: z.infer<typeof sweBenchLoadInstanceSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { absolutePath } = await resolveSafeRepoFile(ctx, input.file);
  return parseSweBenchInstance(await new FileAdapter().readFile(absolutePath, 'utf8'));
}

export async function executeSweBenchWritePrediction(
  input: z.infer<typeof sweBenchWritePredictionSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  return buildSweBenchPredictionOutput(input, ctx);
}

async function buildSweBenchPredictionOutput(
  input: z.infer<typeof swePredictionInputSchema>,
  ctx: ToolRuntimeCtx,
  options: ResolvePatchOptions = {},
) {
  const artifact = await resolvePatch(ctx, input.patch, options);
  const predictionInput = {
    instanceId: input.instanceId,
    modelNameOrPath: input.modelNameOrPath,
    modelPatch: artifact.patch,
  };
  return {
    prediction: buildSweBenchPrediction(predictionInput),
    jsonl: encodeSweBenchPredictionJsonl(predictionInput),
  };
}

export async function executeSweBenchSubmitPredictions(
  input: z.infer<typeof sweBenchSubmitPredictionsSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { absolutePath, relativePath } = await resolveSafeRepoFile(ctx, input.predictionsFile);
  const output = await buildSweBenchPredictionOutput(input, ctx, {
    excludePaths: [relativePath],
  });
  await new FileAdapter().appendFile(absolutePath, output.jsonl);
  return {
    predictionsFile: relativePath,
    appended: true,
    prediction: output.prediction,
  };
}

export async function executeSweBenchGetReport(
  input: z.infer<typeof sweBenchGetReportSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { absolutePath } = await resolveSafeRepoFile(ctx, input.file);
  const parsed = JSON.parse(await new FileAdapter().readFile(absolutePath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SWE-bench report must be a JSON object.');
  }
  return { report: parsed as Record<string, unknown> };
}
