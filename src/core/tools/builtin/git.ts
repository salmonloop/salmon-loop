import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { Phase } from '../../types/runtime.js';
import { repoResource } from '../parallel/resource-helpers.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const gitCatSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.cat',
  source: 'builtin',
  intent: 'READ',
  description: `${text.tools.gitCatDescription} IMPORTANT: The file parameter must be a relative path (e.g., "src/main.ts"). Do NOT use absolute paths or paths with "..".`,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    file: z.string().describe('Path to the file relative to repo root'),
    ref: z.string().default('HEAD').describe('Git reference (branch, hash, or HEAD)'),
  }),
  outputSchema: z.object({
    content: z.string(),
    file: z.string(),
    ref: z.string(),
  }),
  allowedPhases: [Phase.SLASH, Phase.CONTEXT, Phase.AUTOPILOT],
  examples: [
    {
      description: 'Read a file from HEAD revision',
      input: { file: 'src/main.ts', ref: 'HEAD' },
      output: { content: '<file content>', file: 'src/main.ts', ref: 'HEAD' },
    },
    {
      description: 'Read a file from a specific tag',
      input: { file: 'README.md', ref: 'v1.0.0' },
      output: { content: '<file content>', file: 'README.md', ref: 'v1.0.0' },
    },
    {
      description: 'Read a file using default ref (HEAD)',
      input: { file: 'package.json' },
      output: { content: '<file content>', file: 'package.json', ref: 'HEAD' },
    },
  ],
};

/**
 * Builtin tool to read file content from a specific git revision
 */
export async function executeGitCat(
  input: z.infer<typeof gitCatSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { file, ref } = input;

  // Safety check: ensure file path doesn't try to escape
  if (file.includes('..') || file.startsWith('/') || /^[a-zA-Z]:/.test(file)) {
    throw new Error(text.tools.invalidRelativePath(file));
  }

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(['show', `${ref}:${file}`], {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.showFailed(`code=${res.code ?? 'null'} ${res.stderr.trim()}`.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  return {
    content: res.stdout.toString('utf8'),
    file,
    ref,
  };
}

export const gitStatusSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.status',
  source: 'builtin',
  intent: 'LIST',
  description: text.tools.gitStatusDescription,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    porcelain: z.boolean().default(true).describe('Give the output in an easy-to-parse format'),
  }),
  outputSchema: z.object({
    status: z.string(),
  }),
  allowedPhases: [Phase.SLASH, Phase.CONTEXT, Phase.PLAN, Phase.AUTOPILOT, Phase.VERIFY],
};

/**
 * Builtin tool to check git status
 */
export async function executeGitStatus(
  input: z.infer<typeof gitStatusSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { porcelain } = input;
  const args = ['status'];
  if (porcelain) args.push('--porcelain');

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(args, {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.commandFailedDetailed(res.code, res.stderr.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  return {
    status: res.stdout.toString('utf8'),
  };
}

// ── git.blame ─────────────────────────────────────────────────────────

export const gitBlameSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.blame',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.gitBlameDescription,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    file: z.string().describe('Relative path to the file'),
    ref: z.string().optional().describe('Git reference (default: HEAD)'),
    range: z
      .object({
        start: z.number().int().min(1).describe('Start line number'),
        end: z.number().int().min(1).describe('End line number'),
      })
      .optional()
      .describe('Line range to blame'),
  }),
  outputSchema: z.object({
    file: z.string(),
    lines: z.array(
      z.object({
        line: z.number(),
        content: z.string(),
        commit: z.string(),
        author: z.string(),
        authorTime: z.number(),
      }),
    ),
  }),
  allowedPhases: [Phase.SLASH, Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.AUTOPILOT],
};

interface BlameLine {
  line: number;
  content: string;
  commit: string;
  author: string;
  authorTime: number;
}

export async function executeGitBlame(
  input: z.infer<typeof gitBlameSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { file, ref, range } = input;

  if (file.includes('..') || file.startsWith('/') || /^[a-zA-Z]:/.test(file)) {
    throw new Error(text.tools.invalidRelativePath(file));
  }

  const args = ['blame', '--porcelain'];
  if (range) args.push('-L', `${range.start},${range.end}`);
  if (ref) args.push(ref);
  args.push('--', file);

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(args, {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.commandFailedDetailed(res.code, res.stderr.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  const lines = parseBlamePorcelain(res.stdout.toString('utf8'));
  return { file, lines };
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const result: BlameLine[] = [];
  const commitMeta = new Map<string, { author: string; authorTime: number }>();
  let currentCommit = '';
  let currentAuthor = '';
  let currentAuthorTime = 0;

  for (const line of raw.split('\n')) {
    if (!line) continue;

    // Header line: "hash origLine finalLine [numLines]"
    const headerMatch = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(line);
    if (headerMatch) {
      currentCommit = headerMatch[1];
      if (!commitMeta.has(currentCommit)) {
        const meta = commitMeta.get(currentCommit);
        if (meta) {
          currentAuthor = meta.author;
          currentAuthorTime = meta.authorTime;
        }
      }
      continue;
    }

    if (line.startsWith('author ')) {
      currentAuthor = line.slice(7);
      commitMeta.set(currentCommit, { author: currentAuthor, authorTime: currentAuthorTime });
      continue;
    }
    if (line.startsWith('author-time ')) {
      currentAuthorTime = Number(line.slice(12));
      const existing = commitMeta.get(currentCommit);
      if (existing) existing.authorTime = currentAuthorTime;
      else commitMeta.set(currentCommit, { author: currentAuthor, authorTime: currentAuthorTime });
      continue;
    }

    // Content line starts with tab
    if (line.startsWith('\t')) {
      const meta = commitMeta.get(currentCommit) || {
        author: currentAuthor,
        authorTime: currentAuthorTime,
      };
      result.push({
        line: result.length + 1,
        content: line.slice(1),
        commit: currentCommit,
        author: meta.author,
        authorTime: meta.authorTime,
      });
    }
  }

  return result;
}

// ── git.log ───────────────────────────────────────────────────────────

export const gitLogSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.log',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.gitLogDescription,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    ref: z.string().optional().describe('Starting ref (default: HEAD)'),
    maxCount: z.number().int().min(1).max(200).default(20).describe('Max commits to return'),
    file: z.string().optional().describe('Limit to commits touching this file'),
    diffStat: z.boolean().default(false).describe('Include diffstat for each commit'),
  }),
  outputSchema: z.object({
    commits: z.array(
      z.object({
        hash: z.string(),
        subject: z.string(),
        author: z.string(),
        date: z.string(),
        parentHashes: z.string(),
        stat: z.string().optional(),
      }),
    ),
  }),
  allowedPhases: [Phase.SLASH, Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.AUTOPILOT],
};

export async function executeGitLog(
  input: z.infer<typeof gitLogSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { ref, maxCount, file, diffStat } = input;

  const args = ['log', `--format=%H%x00%s%x00%an%x00%aI%x00%P`, '-z', `-n${maxCount}`];
  if (diffStat) args.push('--stat');
  if (ref) args.push(ref);
  if (file) args.push('--', file);

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(args, {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.commandFailedDetailed(res.code, res.stderr.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  const commits = parseLogOutput(res.stdout.toString('utf8'), diffStat);
  return { commits };
}

function parseLogOutput(
  raw: string,
  includeStat: boolean,
): Array<{
  hash: string;
  subject: string;
  author: string;
  date: string;
  parentHashes: string;
  stat?: string;
}> {
  // With -z, records are NUL-separated. Each record is: hash\0subject\0author\0date\0parents[\0stat...]
  const records = raw.split('\0');
  const commits: Array<{
    hash: string;
    subject: string;
    author: string;
    date: string;
    parentHashes: string;
    stat?: string;
  }> = [];

  // Each commit has 5 core fields; stat is optional extra
  const fieldsPerCommit = 5;
  let i = 0;

  while (i + fieldsPerCommit - 1 < records.length) {
    const hash = records[i].replace(/^\n/, '');
    const subject = records[i + 1];
    const author = records[i + 2];
    const date = records[i + 3];
    const parentHashes = records[i + 4];
    i += fieldsPerCommit;

    let stat: string | undefined;
    if (includeStat && i < records.length) {
      // The stat portion may contain newlines; collect until next commit header or end
      const nextCommitIdx = records.findIndex(
        (r, idx) => idx >= i && /^[0-9a-f]{40}/.test(r.replace(/^\n/, '')),
      );
      const endIdx = nextCommitIdx > i ? nextCommitIdx : records.length;
      stat = records.slice(i, endIdx).join('\0').trim() || undefined;
      i = endIdx;
    }

    commits.push({ hash, subject, author, date, parentHashes, stat });
  }

  return commits;
}

// ── git.show ──────────────────────────────────────────────────────────

export const gitShowSpec: Omit<ToolSpec, 'executor'> = {
  name: 'git.show',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.gitShowDescription,
  riskLevel: 'low',
  sideEffects: ['git_read'],
  concurrency: 'parallel_ok',
  computeResources: (_input, ctx) => [repoResource(ctx)],
  inputSchema: z.object({
    ref: z.string().describe('Git reference (commit hash, branch, tag)'),
    stat: z.boolean().default(true).describe('Include diffstat'),
  }),
  outputSchema: z.object({
    ref: z.string(),
    content: z.string(),
  }),
  allowedPhases: [Phase.SLASH, Phase.CONTEXT, Phase.EXPLORE, Phase.PLAN, Phase.AUTOPILOT],
};

export async function executeGitShow(
  input: z.infer<typeof gitShowSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { ref, stat } = input;

  const args = ['show'];
  if (stat) args.push('--stat');
  args.push(ref);

  const repoRoot = ctx.worktreeRoot || ctx.repoRoot;
  const git = new GitAdapter(repoRoot);
  const res = await git.execMeta(args, {
    cwd: repoRoot,
    env: ctx.env,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) {
    if (res.error?.message) throw new Error(text.git.processError(res.error.message));
    throw new Error(text.git.commandFailedDetailed(res.code, res.stderr.trim()));
  }
  if (res.stdoutTruncated) throw new Error(text.git.outputTruncated(LIMITS.maxToolOutputBytes));

  return {
    ref,
    content: res.stdout.toString('utf8'),
  };
}
