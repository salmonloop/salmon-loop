import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface UnitBoundaryViolation {
  filePath: string;
  reason: string;
}

interface UnitBoundaryCheckOptions {
  includePaths?: string[];
}

const UNIT_TEST_ROOT = 'tests/unit';
const ALLOWLIST_PATH = path.join('tests', 'unit-boundary-allowlist.json');

const CHILD_PROCESS_IMPORT = /from\s+['"](?:node:)?child_process['"]/;
const FS_IMPORT = /from\s+['"](?:node:)?fs(?:\/promises)?['"]/;
const FS_MUTATION_CALL =
  /\b(?:appendFile|appendFileSync|chmod|chmodSync|chown|chownSync|cp|cpSync|mkdtemp|mkdtempSync|mkdir|mkdirSync|open|openSync|rename|renameSync|rm|rmSync|rmdir|rmdirSync|symlink|symlinkSync|utimes|utimesSync|writeFile|writeFileSync)\s*\(/;
const BUN_FS_MUTATION = /\bBun\.(?:write|file)\s*\(/;

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function parseCliArgs(argv: string[]): { staged: boolean } {
  const staged = argv.includes('--staged');
  const unknown = argv.filter((arg) => arg !== '--staged');
  if (unknown.length > 0) {
    throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
  }
  return { staged };
}

function getStagedFiles(repoRoot: string): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }
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

function resolveIncludeSet(options?: UnitBoundaryCheckOptions): Set<string> | undefined {
  if (!options?.includePaths) return undefined;
  const set = new Set<string>();
  for (const filePath of options.includePaths) {
    set.add(normalizePathForMatch(path.normalize(filePath)));
  }
  return set;
}

function shouldCheckFile(relativePath: string, includeSet: Set<string> | undefined): boolean {
  if (!includeSet) return true;
  return includeSet.has(normalizePathForMatch(relativePath));
}

async function collectUnitTestFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectUnitTestFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.test\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

async function loadAllowlist(repoRoot: string): Promise<Set<string>> {
  const allowlistFile = path.join(repoRoot, ALLOWLIST_PATH);
  const raw = await readFile(allowlistFile, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${ALLOWLIST_PATH} must be a JSON array`);
  }
  const allowlist = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${ALLOWLIST_PATH} entries must be non-empty strings`);
    }
    allowlist.add(normalizePathForMatch(value));
  }
  return allowlist;
}

export async function findUnitBoundaryViolations(
  repoRoot: string,
  options?: UnitBoundaryCheckOptions,
): Promise<UnitBoundaryViolation[]> {
  const includeSet = resolveIncludeSet(options);
  const allowlist = await loadAllowlist(repoRoot);
  const unitTestRoot = path.join(repoRoot, UNIT_TEST_ROOT);
  const files = await collectUnitTestFiles(unitTestRoot);

  const violations: UnitBoundaryViolation[] = [];

  for (const fullPath of files) {
    const relativePath = normalizePathForMatch(path.relative(repoRoot, fullPath));
    if (!shouldCheckFile(relativePath, includeSet)) continue;
    if (allowlist.has(relativePath)) continue;

    const content = await readFile(fullPath, 'utf-8');

    if (CHILD_PROCESS_IMPORT.test(content)) {
      violations.push({
        filePath: relativePath,
        reason: 'child_process import is forbidden in unit tests',
      });
      continue;
    }
    if (FS_IMPORT.test(content) && FS_MUTATION_CALL.test(content)) {
      violations.push({
        filePath: relativePath,
        reason: 'filesystem mutation is forbidden in unit tests',
      });
      continue;
    }
    if (BUN_FS_MUTATION.test(content)) {
      violations.push({
        filePath: relativePath,
        reason: 'Bun filesystem mutation is forbidden in unit tests',
      });
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
    if (includePaths.length === 0) {
      console.log('Unit boundary check skipped: no staged files.');
      return;
    }
  }

  const violations = await findUnitBoundaryViolations(repoRoot, { includePaths });
  if (violations.length === 0) {
    console.log('Unit boundary check passed: unit tests avoid real process/filesystem mutation.');
    return;
  }

  console.error(`Unit boundary check failed: found ${violations.length} violation(s).`);
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
