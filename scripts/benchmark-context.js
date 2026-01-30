import { createHash } from 'crypto';
import path from 'path';
import { performance } from 'perf_hooks';

import { ContextService } from '../dist/src/core/context/service.js';
import { ContextBuilder } from '../dist/src/core/context.js';
import { formatContextForPrompt } from '../dist/src/core/llm-utils.js';

/**
 * @typedef {'primary' | 'ast_related'} DiffScope
 *
 * @typedef {object} BenchmarkCase
 * @property {string} id
 * @property {string} description
 * @property {string} instruction
 * @property {string} primaryFile
 * @property {DiffScope} diffScope
 * @property {string[]} expectedFiles
 */

/** @type {BenchmarkCase[]} */
const CASES = [
  {
    id: 'A-targeted-lock',
    description: 'Targeted fix for a single module',
    instruction: 'Fix stale lock handling in acquireLock in readonly-lock.ts',
    primaryFile: 'src/core/strata/layers/shadow-driver/readonly-lock.ts',
    diffScope: 'ast_related',
    expectedFiles: [
      'src/core/strata/layers/shadow-driver/readonly-lock.ts',
      'src/core/logger.ts',
      'src/core/path.ts',
    ],
  },
  {
    id: 'B-broad-shadow-driver',
    description: 'Broad refactor across a small subsystem',
    instruction: 'Improve ShadowDriver setup logging across strategies',
    primaryFile: 'src/core/strata/layers/shadow-driver/shadow-driver.ts',
    diffScope: 'ast_related',
    expectedFiles: [
      'src/core/strata/layers/shadow-driver/shadow-driver.ts',
      'src/core/strata/layers/shadow-driver/copy-backend.ts',
      'src/core/strata/layers/shadow-driver/readonly-lock.ts',
      'src/core/strata/layers/shadow-driver/strategy.ts',
    ],
  },
  {
    id: 'C-cross-module-tools',
    description: 'Cross-module behavior with backends and routing',
    instruction: 'Fix code search fallback behavior when rg is unavailable',
    primaryFile: 'src/core/tools/builtin/code-search/executor.ts',
    diffScope: 'ast_related',
    expectedFiles: [
      'src/core/tools/builtin/code-search/executor.ts',
      'src/core/tools/builtin/code-search/backends/rg.ts',
      'src/core/tools/builtin/code-search/backends/powershell.ts',
      'src/core/tools/capability/executor.ts',
    ],
  },
];

function normalizeRepoRelative(p) {
  return String(p)
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '');
}

function hashString(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
}

function extractDiffPaths(diffText) {
  if (!diffText) return [];
  const out = [];

  const diffHeader = /^diff --git a\/(.+?) b\/(.+)$/gm;
  for (const match of diffText.matchAll(diffHeader)) {
    const bPath = match[2];
    if (bPath) out.push(bPath);
  }

  const plusPlus = /^\+\+\+ b\/(.+)$/gm;
  for (const match of diffText.matchAll(plusPlus)) {
    const bPath = match[1];
    if (bPath && bPath !== '/dev/null') out.push(bPath);
  }

  return out.map(normalizeRepoRelative);
}

function extractIncludedFilesFromContext(context) {
  const included = new Set();

  if (context.primaryFile) included.add(normalizeRepoRelative(context.primaryFile));

  for (const file of context.relatedFiles || []) {
    included.add(normalizeRepoRelative(file.path));
  }

  for (const snippet of context.rgSnippets || []) {
    included.add(normalizeRepoRelative(snippet.file));
  }

  for (const p of extractDiffPaths(context.stagedDiff)) included.add(p);
  for (const p of extractDiffPaths(context.unstagedDiff)) included.add(p);
  for (const p of extractDiffPaths(context.gitDiff)) included.add(p);

  return included;
}

function recall(included, expectedFiles) {
  const expected = expectedFiles.map(normalizeRepoRelative);
  const missing = expected.filter((p) => !included.has(p));
  const hit = expected.length - missing.length;
  const pct = expected.length === 0 ? 1 : hit / expected.length;
  return { hit, total: expected.length, pct, missing };
}

function parseArgs(argv) {
  const args = new Map();
  const flags = new Set();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    args.set(key, next);
    i++;
  }

  const rawCases = String(args.get('cases') ?? '');
  const cases = rawCases
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const rawRepeat = Number(args.get('repeat') ?? '1');
  const rawBudgetChars = args.get('budget-chars') ? Number(args.get('budget-chars')) : undefined;
  /** @type {DiffScope | undefined} */
  const diffScope = args.get('diff-scope');

  return {
    repo: args.get('repo') ?? process.cwd(),
    cases,
    repeat: rawRepeat,
    diffScope,
    budgetChars: rawBudgetChars,
    showMissing: flags.has('show-missing'),
  };
}

async function runOnce(params) {
  const { service, repoPath, instruction, primaryFile, diffScope, budgetChars } = params;

  const t0Old = performance.now();
  const oldContext = await ContextBuilder.build({
    instruction,
    verify: 'true',
    repoPath,
    file: primaryFile,
  });
  const oldPrompt = formatContextForPrompt(oldContext);
  const t1Old = performance.now();

  const t0New = performance.now();
  const newResult = await service.build({
    instruction,
    repoPath,
    primaryFile,
    diffScope,
    budgetChars,
  });
  const t1New = performance.now();

  return {
    old: {
      context: oldContext,
      prompt: oldPrompt,
      latencyMs: t1Old - t0Old,
    },
    next: {
      result: newResult,
      latencyMs: t1New - t0New,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoPath = path.resolve(args.repo);

  if (!Number.isFinite(args.repeat) || args.repeat <= 0) {
    throw new Error('Invalid --repeat value.');
  }

  if (
    args.budgetChars !== undefined &&
    (!Number.isFinite(args.budgetChars) || args.budgetChars <= 0)
  ) {
    throw new Error('Invalid --budget-chars value.');
  }

  const selected = args.cases.length === 0 ? CASES : CASES.filter((c) => args.cases.includes(c.id));
  if (selected.length === 0) throw new Error('No benchmark cases selected.');

  const service = new ContextService();
  const rows = [];

  for (const c of selected) {
    /** @type {DiffScope} */
    const diffScope = args.diffScope ?? c.diffScope;

    let oldLatency = 0;
    let newLatency = 0;
    let lastOldPrompt = '';
    let lastNewPrompt = '';
    let lastResult = null;

    for (let i = 0; i < args.repeat; i++) {
      const run = await runOnce({
        service,
        repoPath,
        instruction: c.instruction,
        primaryFile: c.primaryFile,
        diffScope,
        budgetChars: args.budgetChars,
      });

      oldLatency += run.old.latencyMs;
      newLatency += run.next.latencyMs;
      lastOldPrompt = run.old.prompt;
      lastNewPrompt = run.next.result.prompt;
      lastResult = run.next.result;
    }

    const avgOld = oldLatency / args.repeat;
    const avgNew = newLatency / args.repeat;

    const included = extractIncludedFilesFromContext(lastResult.context);
    const r = recall(included, c.expectedFiles);

    const mismatch = hashString(lastOldPrompt) !== hashString(lastNewPrompt);

    const missingPreview = r.missing.slice(0, 3).join(', ');
    const missingSuffix = r.missing.length > 3 ? ` (+${r.missing.length - 3})` : '';

    rows.push({
      id: c.id,
      diffScope,
      usedChars: lastResult.meta.usedChars,
      promptChars: lastResult.prompt.length,
      truncated: lastResult.meta.truncated,
      recall: `${Math.round(r.pct * 100)}% (${r.hit}/${r.total})`,
      missing: r.missing.length ? `${missingPreview}${missingSuffix}` : '',
      latencyMs_new: Math.round(avgNew),
      latencyMs_old: Math.round(avgOld),
      promptMismatch: mismatch,
    });

    if (args.showMissing && r.missing.length > 0) {
      console.log(`\n[${c.id}] Missing expected files:`);
      for (const m of r.missing) console.log(`- ${m}`);
    }
  }

  console.table(rows);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
