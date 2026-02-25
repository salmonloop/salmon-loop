import { spawnSync } from 'child_process';
import { access, readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const SCAN_ROOT = 'src';
const ALLOWLIST_PATH = path.join('scripts', 'fs-git-boundary-allowlist.json');

const FS_IMPORT = /from\s+['"](?:node:)?fs(?:\/promises)?['"]/;
const GIT_DIRECT_COMMAND =
  /command\s*:\s*['"]git['"]|\bspawn(?:Sync)?\s*\(\s*['"]git['"]|\bexeca\s*\(\s*['"]git['"]/;

interface BoundaryViolation {
  filePath: string;
  reason: 'fs-direct-import' | 'git-direct-command';
}

interface BoundaryAllowlist {
  fsDirectImports: string[];
  gitDirectCommands: string[];
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

async function loadAllowlist(repoRoot: string): Promise<BoundaryAllowlist> {
  const raw = await readFile(path.join(repoRoot, ALLOWLIST_PATH), 'utf-8');
  const parsed = JSON.parse(raw) as Partial<BoundaryAllowlist>;

  if (!Array.isArray(parsed.fsDirectImports) || !Array.isArray(parsed.gitDirectCommands)) {
    throw new Error(`${ALLOWLIST_PATH} must contain fsDirectImports[] and gitDirectCommands[]`);
  }

  return {
    fsDirectImports: parsed.fsDirectImports.map((item) => normalizePathForMatch(item)),
    gitDirectCommands: parsed.gitDirectCommands.map((item) => normalizePathForMatch(item)),
  };
}

export async function findFsGitBoundaryViolations(
  repoRoot: string,
  options?: { includePaths?: string[] },
): Promise<BoundaryViolation[]> {
  const allowlist = await loadAllowlist(repoRoot);
  const fsAllow = new Set(allowlist.fsDirectImports);
  const gitAllow = new Set(allowlist.gitDirectCommands);

  const selected = (options?.includePaths || [])
    .map((p) => normalizePathForMatch(path.normalize(p)))
    .filter((p) => isUnderScanRoot(p));

  const files =
    selected.length > 0
      ? selected
      : (await collectFilesRecursively(path.join(repoRoot, SCAN_ROOT))).map((fullPath) =>
          normalizePathForMatch(path.relative(repoRoot, fullPath)),
        );

  const violations: BoundaryViolation[] = [];

  for (const relPath of files) {
    const fullPath = path.join(repoRoot, relPath);
    if (!(await pathExists(fullPath))) continue;

    const content = await readFile(fullPath, 'utf-8');

    if (FS_IMPORT.test(content) && !fsAllow.has(relPath)) {
      violations.push({ filePath: relPath, reason: 'fs-direct-import' });
    }

    if (GIT_DIRECT_COMMAND.test(content) && !gitAllow.has(relPath)) {
      violations.push({ filePath: relPath, reason: 'git-direct-command' });
    }
  }

  return violations;
}

async function main() {
  const repoRoot = process.cwd();
  const args = parseCliArgs(process.argv.slice(2));

  let includePaths: string[] | undefined;
  if (args.staged) {
    includePaths = getStagedFiles(repoRoot);
    const stagedSrcFiles = includePaths.filter((filePath) => isUnderScanRoot(filePath));
    if (stagedSrcFiles.length === 0) {
      console.log('FS/Git boundary check skipped: no staged files under src/.');
      return;
    }
  }

  const violations = await findFsGitBoundaryViolations(repoRoot, { includePaths });
  if (violations.length === 0) {
    console.log('FS/Git boundary check passed: no out-of-bound direct fs*/git usage found.');
    return;
  }

  console.error(`FS/Git boundary check failed: found ${violations.length} violation(s).`);
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
