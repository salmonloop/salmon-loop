import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const RUNTIME_COMMAND_PATTERN = /\b(?:bun|npm|pnpm|yarn)\s+run\b/g;
const SCAN_ROOT = 'src';
const ALLOWED_PREFIX = path.join('src', 'core', 'target-runtime') + path.sep;

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

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAllowedFile(filePath: string): boolean {
  return filePath.startsWith(ALLOWED_PREFIX);
}

function toLineColumn(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = before.split('\n').length;
  const lastLineStart = before.lastIndexOf('\n');
  const column = index - (lastLineStart + 1) + 1;
  return { line, column };
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
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function findRuntimeCommandHardcoding(
  repoRoot: string,
): Promise<RuntimeCommandViolation[]> {
  const srcRoot = path.join(repoRoot, SCAN_ROOT);
  const allFiles = await collectFilesRecursively(srcRoot);
  const violations: RuntimeCommandViolation[] = [];

  for (const fullPath of allFiles) {
    const relPath = path.relative(repoRoot, fullPath);
    if (isAllowedFile(relPath)) continue;
    if (!isTextFile(relPath)) continue;

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

async function main() {
  const repoRoot = process.cwd();
  const violations = await findRuntimeCommandHardcoding(repoRoot);
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
