import { spawnSync } from 'child_process';
import { readdir, readFile, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const RUNTIME_COMMAND_PATTERN = /\b(?:bun|npm|pnpm|yarn)\s+run\b/g;
const SCAN_ROOT = 'src';
const ALLOWED_PREFIX = 'src/core/target-runtime/';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.hbs',
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
]);

export interface RuntimeCommandViolation {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
}

export interface RuntimeCommandCheckOptions {
  includePaths?: string[];
}

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isUnderScanRoot(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return normalized === SCAN_ROOT || normalized.startsWith(`${SCAN_ROOT}/`);
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAllowedFile(filePath: string): boolean {
  return normalizePathForMatch(filePath).startsWith(ALLOWED_PREFIX);
}

function toLineColumn(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = before.split('\n').length;
  const lastLineStart = before.lastIndexOf('\n');
  const column = index - (lastLineStart + 1) + 1;
  return { line, column };
}

async function collectFilesRecursively(rootPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile()) {
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

function resolveCandidateFilesFromOptions(
  repoRoot: string,
  options?: RuntimeCommandCheckOptions,
): string[] | undefined {
  if (!options?.includePaths) return undefined;
  const files = new Set<string>();
  for (const relativePath of options.includePaths) {
    const normalized = normalizePathForMatch(path.normalize(relativePath));
    if (!isUnderScanRoot(normalized)) continue;
    files.add(normalized);
  }
  return Array.from(files);
}

export async function findRuntimeCommandHardcoding(
  repoRoot: string,
  options?: RuntimeCommandCheckOptions,
): Promise<RuntimeCommandViolation[]> {
  const selectedFiles = resolveCandidateFilesFromOptions(repoRoot, options);
  const allFiles =
    selectedFiles ??
    (await collectFilesRecursively(path.join(repoRoot, SCAN_ROOT))).map((fullPath) =>
      normalizePathForMatch(path.relative(repoRoot, fullPath)),
    );
  const violations: RuntimeCommandViolation[] = [];

  for (const relPath of allFiles) {
    if (isAllowedFile(relPath)) continue;
    if (!isTextFile(relPath)) continue;

    const fullPath = path.join(repoRoot, relPath);
    if (!(await pathExists(fullPath))) continue;

    const content = await readFile(fullPath, 'utf-8');
    let match: RegExpExecArray | null;
    RUNTIME_COMMAND_PATTERN.lastIndex = 0;
    while ((match = RUNTIME_COMMAND_PATTERN.exec(content)) !== null) {
      const { line, column } = toLineColumn(content, match.index);
      violations.push({
        filePath: relPath,
        line,
        column,
        snippet: match[0],
      });
    }
  }

  return violations;
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

function parseCliArgs(argv: string[]): { staged: boolean } {
  const staged = argv.includes('--staged');
  const unknown = argv.filter((arg) => arg !== '--staged');
  if (unknown.length > 0) {
    throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
  }
  return { staged };
}

async function main() {
  const repoRoot = process.cwd();
  const args = parseCliArgs(process.argv.slice(2));

  let includePaths: string[] | undefined;
  if (args.staged) {
    includePaths = getStagedFiles(repoRoot);
    const stagedSrcFiles = includePaths.filter((filePath) => isUnderScanRoot(filePath));
    if (stagedSrcFiles.length === 0) {
      console.log('Runtime command boundary check skipped: no staged files under src/.');
      return;
    }
  }

  const violations = await findRuntimeCommandHardcoding(repoRoot, { includePaths });
  if (violations.length === 0) {
    console.log(
      `Runtime command boundary check passed: no package-manager run hardcoding found outside ${path.join('src', 'core', 'target-runtime')}/`,
    );
    return;
  }

  console.error(
    `Runtime command boundary check failed: found ${violations.length} disallowed occurrence(s).`,
  );
  for (const violation of violations) {
    console.error(
      `- ${violation.filePath}:${violation.line}:${violation.column} -> ${JSON.stringify(violation.snippet)}`,
    );
  }
  process.exitCode = 1;
}

const thisFile = fileURLToPath(import.meta.url);
const entryFile = path.resolve(process.argv[1] || '');
if (entryFile === thisFile) {
  void main();
}
