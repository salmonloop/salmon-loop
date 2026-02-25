import { spawnSync } from 'child_process';
import { access, readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import ts from 'typescript';

const SCAN_ROOT = 'src';
const ALLOWLIST_PATH = path.join('scripts', 'bun-native-boundary-allowlist.json');

interface BunBoundaryViolation {
  filePath: string;
  reason: 'bun-direct-usage';
}

interface BunBoundaryAllowEntry {
  path: string;
  owner: string;
  reason: string;
  expiresAt?: string;
}

interface BunBoundaryAllowlist {
  bunDirectUsage: BunBoundaryAllowEntry[];
}

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isUnderScanRoot(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return normalized === SCAN_ROOT || normalized.startsWith(`${SCAN_ROOT}/`);
}

function parseCliArgs(argv: string[]): { staged: boolean } {
  const staged = argv.includes('--staged');
  const unknown = argv.filter((arg) => arg !== '--staged');
  if (unknown.length > 0) {
    throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
  }
  return { staged };
}

async function collectFilesRecursively(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getStagedFiles(repoRoot: string): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      (result.stderr || '').trim() || `git diff failed with exit code ${result.status}`,
    );
  }

  return (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizePathForMatch(line));
}

async function loadAllowlist(repoRoot: string): Promise<BunBoundaryAllowlist> {
  const raw = await readFile(path.join(repoRoot, ALLOWLIST_PATH), 'utf-8');
  const parsed = JSON.parse(raw) as Partial<BunBoundaryAllowlist>;

  if (!Array.isArray(parsed.bunDirectUsage)) {
    throw new Error(`${ALLOWLIST_PATH} must contain bunDirectUsage[]`);
  }

  return {
    bunDirectUsage: normalizeAllowEntries(parsed.bunDirectUsage),
  };
}

function normalizeAllowEntries(entries: unknown[]): BunBoundaryAllowEntry[] {
  return entries.map((entry, index) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as any).path !== 'string' ||
      typeof (entry as any).owner !== 'string' ||
      typeof (entry as any).reason !== 'string'
    ) {
      throw new Error(
        `${ALLOWLIST_PATH} bunDirectUsage[${index}] must include path, owner, reason`,
      );
    }

    const normalized: BunBoundaryAllowEntry = {
      path: normalizePathForMatch((entry as any).path),
      owner: (entry as any).owner,
      reason: (entry as any).reason,
    };
    if (typeof (entry as any).expiresAt === 'string') {
      normalized.expiresAt = (entry as any).expiresAt;
    }
    return normalized;
  });
}

export async function findBunNativeBoundaryViolations(
  repoRoot: string,
  options?: { includePaths?: string[] },
): Promise<BunBoundaryViolation[]> {
  const allowlist = await loadAllowlist(repoRoot);
  const bunAllow = new Set(allowlist.bunDirectUsage.map((entry) => entry.path));

  const selected = (options?.includePaths || [])
    .map((p) => normalizePathForMatch(path.normalize(p)))
    .filter((p) => isUnderScanRoot(p));

  const files =
    selected.length > 0
      ? selected
      : (await collectFilesRecursively(path.join(repoRoot, SCAN_ROOT))).map((fullPath) =>
          normalizePathForMatch(path.relative(repoRoot, fullPath)),
        );

  const violations: BunBoundaryViolation[] = [];

  for (const relPath of files) {
    const fullPath = path.join(repoRoot, relPath);
    if (!(await pathExists(fullPath))) continue;

    const content = await readFile(fullPath, 'utf-8');
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
    if (detectBunDirectUsage(sourceFile) && !bunAllow.has(relPath)) {
      violations.push({ filePath: relPath, reason: 'bun-direct-usage' });
    }
  }

  return violations;
}

function detectBunDirectUsage(sourceFile: ts.SourceFile): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Bun'
    ) {
      found = true;
      return;
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Bun'
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

async function main() {
  const repoRoot = process.cwd();
  const args = parseCliArgs(process.argv.slice(2));

  let includePaths: string[] | undefined;
  if (args.staged) {
    includePaths = getStagedFiles(repoRoot);
    const stagedSrcFiles = includePaths.filter((filePath) => isUnderScanRoot(filePath));
    if (stagedSrcFiles.length === 0) {
      console.log('Bun boundary check skipped: no staged files under src/.');
      return;
    }
  }

  const violations = await findBunNativeBoundaryViolations(repoRoot, { includePaths });
  if (violations.length === 0) {
    console.log('Bun boundary check passed: no out-of-bound Bun.* usage found.');
    return;
  }

  console.error(`Bun boundary check failed: found ${violations.length} violation(s).`);
  for (const violation of violations) {
    console.error(`- ${violation.filePath} -> ${violation.reason}`);
  }
  process.exitCode = 1;
}

const thisFile = fileURLToPath(import.meta.url);
const entryFile = path.resolve(process.argv[1] || '');
if (entryFile === thisFile) {
  void main();
}
