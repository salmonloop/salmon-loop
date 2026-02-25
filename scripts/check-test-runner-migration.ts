import { readdir, readFile, access } from 'fs/promises';
import path from 'path';

interface Violation {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
}

const TARGET_FILES = ['package.json'] as const;
const TARGET_DIRS = ['docs', '.githooks', '.github/workflows', '.github/actions'] as const;
const EXCLUDED_PREFIXES = ['docs/plans/'] as const;

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'vitest', pattern: /\bvitest\b/gi },
  { name: 'verify-jest', pattern: /--verify\s+"[^"]*\bjest\b[^"]*"/gi },
  { name: 'verify-vitest', pattern: /--verify\s+"[^"]*\bvitest\b[^"]*"/gi },
  { name: 'verify-broken-bun-run', pattern: /--verify\s+"bun run\s*"/gi },
];

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
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

function toLineColumn(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n');
  const column = index - (lineStart + 1) + 1;
  return { line, column };
}

function collectViolations(content: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  for (const entry of FORBIDDEN_PATTERNS) {
    entry.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.pattern.exec(content)) !== null) {
      const { line, column } = toLineColumn(content, match.index);
      violations.push({
        filePath,
        line,
        column,
        snippet: `${entry.name}: ${match[0]}`,
      });
    }
  }
  return violations;
}

async function main() {
  const repoRoot = process.cwd();
  const violations: Violation[] = [];

  for (const relativePath of TARGET_FILES) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!(await pathExists(fullPath))) continue;
    const content = await readFile(fullPath, 'utf-8');
    violations.push(...collectViolations(content, normalizePath(relativePath)));
  }

  for (const targetDir of TARGET_DIRS) {
    const files = await collectFilesRecursively(path.join(repoRoot, targetDir));
    for (const fullPath of files) {
      const relativePath = normalizePath(path.relative(repoRoot, fullPath));
      if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
        continue;
      }
      const content = await readFile(fullPath, 'utf-8');
      violations.push(...collectViolations(content, relativePath));
    }
  }

  if (violations.length === 0) {
    console.log('Test-runner migration check passed: no Vitest/Jest residue in runtime docs/scripts.');
    return;
  }

  console.error(`Test-runner migration check failed: found ${violations.length} violation(s).`);
  for (const violation of violations) {
    console.error(
      `- ${violation.filePath}:${violation.line}:${violation.column} -> ${JSON.stringify(violation.snippet)}`,
    );
  }
  process.exitCode = 1;
}

void main();
