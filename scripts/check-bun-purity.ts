import { spawnSync } from 'child_process';
import { readdir, readFile, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'node', pattern: /\bnode\s+/g },
  { name: 'npx', pattern: /\bnpx\b/g },
  { name: 'npm', pattern: /\bnpm\s+(?:run|test|install|ci|exec)\b/g },
  { name: 'pnpm', pattern: /\bpnpm\s+/g },
  { name: 'yarn', pattern: /\byarn\s+/g },
];

const TARGET_FILES = ['package.json', 'tests/helpers/cli-runner.ts'] as const;
const TARGET_DIRS = ['.github/workflows', '.github/actions', '.githooks'] as const;
const PACKAGE_LIFECYCLE_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepack',
  'prepare',
  'postpack',
  'prepublishOnly',
  'preversion',
  'version',
  'postversion',
]);

export interface BunPurityViolation {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
  source: 'script' | 'text';
}

export interface BunPurityCheckOptions {
  includePaths?: string[];
}

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function toLineColumn(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = before.split('\n').length;
  const lastLineStart = before.lastIndexOf('\n');
  const column = index - (lastLineStart + 1) + 1;
  return { line, column };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFilesRecursively(rootPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function resolveIncludeSet(options?: BunPurityCheckOptions): Set<string> | undefined {
  if (!options?.includePaths) return undefined;
  const set = new Set<string>();
  for (const filePath of options.includePaths) {
    set.add(normalizePathForMatch(path.normalize(filePath)));
  }
  return set;
}

function shouldCheckFile(
  relativePath: string,
  includeSet: Set<string> | undefined,
  options?: { prefixMode?: boolean },
): boolean {
  if (!includeSet) return true;
  const normalized = normalizePathForMatch(relativePath);
  if (includeSet.has(normalized)) return true;
  if (options?.prefixMode) {
    for (const included of includeSet) {
      if (included.startsWith(`${normalized}/`)) return true;
    }
  }
  return false;
}

function collectPatternMatches(
  content: string,
): Array<{ index: number; snippet: string; patternName: string }> {
  const matches: Array<{ index: number; snippet: string; patternName: string }> = [];

  for (const entry of FORBIDDEN_PATTERNS) {
    entry.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.pattern.exec(content)) !== null) {
      matches.push({
        index: match.index,
        snippet: match[0],
        patternName: entry.name,
      });
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

function parsePackageScripts(content: string): Record<string, string> {
  const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
  const scripts = parsed.scripts ?? {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

export async function findBunPurityViolations(
  repoRoot: string,
  options?: BunPurityCheckOptions,
): Promise<BunPurityViolation[]> {
  const includeSet = resolveIncludeSet(options);
  const violations: BunPurityViolation[] = [];

  for (const relativePath of TARGET_FILES) {
    if (!shouldCheckFile(relativePath, includeSet)) continue;
    const fullPath = path.join(repoRoot, relativePath);
    if (!(await pathExists(fullPath))) continue;

    const content = await readFile(fullPath, 'utf-8');
    if (relativePath === 'package.json') {
      const scripts = parsePackageScripts(content);
      for (const [scriptName, command] of Object.entries(scripts)) {
        if (PACKAGE_LIFECYCLE_SCRIPTS.has(scriptName)) continue;
        const matches = collectPatternMatches(command);
        for (const match of matches) {
          violations.push({
            filePath: relativePath,
            line: 1,
            column: match.index + 1,
            snippet: `${scriptName}: ${match.snippet}`,
            source: 'script',
          });
        }
      }
      continue;
    }

    const matches = collectPatternMatches(content);
    for (const match of matches) {
      const { line, column } = toLineColumn(content, match.index);
      violations.push({
        filePath: relativePath,
        line,
        column,
        snippet: match.snippet,
        source: 'text',
      });
    }
  }

  for (const targetDir of TARGET_DIRS) {
    const normalizedDir = normalizePathForMatch(targetDir);
    if (!shouldCheckFile(normalizedDir, includeSet, { prefixMode: true })) continue;
    const files = await collectFilesRecursively(path.join(repoRoot, targetDir));
    for (const fullPath of files) {
      const relativePath = normalizePathForMatch(path.relative(repoRoot, fullPath));
      if (!shouldCheckFile(relativePath, includeSet)) continue;

      const content = await readFile(fullPath, 'utf-8');
      const matches = collectPatternMatches(content);
      for (const match of matches) {
        const { line, column } = toLineColumn(content, match.index);
        violations.push({
          filePath: relativePath,
          line,
          column,
          snippet: match.snippet,
          source: 'text',
        });
      }
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
    if (includePaths.length === 0) {
      console.log('Bun purity check skipped: no staged files.');
      return;
    }
  }

  const violations = await findBunPurityViolations(repoRoot, { includePaths });
  if (violations.length === 0) {
    console.log('Bun purity check passed: no forbidden command usage in development chain.');
    return;
  }

  console.error(`Bun purity check failed: found ${violations.length} violation(s).`);
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
