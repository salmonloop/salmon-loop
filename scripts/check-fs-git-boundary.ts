import { spawnSync } from 'child_process';
import { access, readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import ts from 'typescript';

const SCAN_ROOT = 'src';
const ALLOWLIST_PATH = path.join('scripts', 'fs-git-boundary-allowlist.json');

const FS_MODULES = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises']);
const PROCESS_MODULES = new Set(['child_process', 'node:child_process']);
const GIT_SPAWN_CALLS = new Set(['spawn', 'spawnSync', 'execa']);
const BUN_PROCESS_APIS = new Set(['spawn', 'spawnSync']);

interface BoundaryViolation {
  filePath: string;
  reason: 'fs-direct-import' | 'git-direct-command' | 'process-direct-command';
}

interface BoundaryAllowEntry {
  path: string;
  owner: string;
  reason: string;
  expiresAt?: string;
}

interface BoundaryAllowlist {
  fsDirectImports: BoundaryAllowEntry[];
  gitDirectCommands: BoundaryAllowEntry[];
  processDirectCommands: BoundaryAllowEntry[];
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

  if (
    !Array.isArray(parsed.fsDirectImports) ||
    !Array.isArray(parsed.gitDirectCommands) ||
    !Array.isArray(parsed.processDirectCommands)
  ) {
    throw new Error(
      `${ALLOWLIST_PATH} must contain fsDirectImports[], gitDirectCommands[], processDirectCommands[]`,
    );
  }

  return {
    fsDirectImports: normalizeAllowEntries(parsed.fsDirectImports, 'fsDirectImports'),
    gitDirectCommands: normalizeAllowEntries(parsed.gitDirectCommands, 'gitDirectCommands'),
    processDirectCommands: normalizeAllowEntries(
      parsed.processDirectCommands,
      'processDirectCommands',
    ),
  };
}

function normalizeAllowEntries(entries: unknown[], field: string): BoundaryAllowEntry[] {
  return entries.map((entry, index) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as any).path !== 'string' ||
      typeof (entry as any).owner !== 'string' ||
      typeof (entry as any).reason !== 'string'
    ) {
      throw new Error(`${ALLOWLIST_PATH} ${field}[${index}] must include path, owner, reason`);
    }

    const normalized: BoundaryAllowEntry = {
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

export async function findFsGitBoundaryViolations(
  repoRoot: string,
  options?: { includePaths?: string[] },
): Promise<BoundaryViolation[]> {
  const allowlist = await loadAllowlist(repoRoot);
  const fsAllow = new Set(allowlist.fsDirectImports.map((entry) => entry.path));
  const gitAllow = new Set(allowlist.gitDirectCommands.map((entry) => entry.path));
  const processAllow = new Set(allowlist.processDirectCommands.map((entry) => entry.path));

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
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
    const hasFsDirectImport = detectFsDirectImport(sourceFile);
    const hasGitDirectCommand = detectGitDirectCommand(sourceFile);
    const hasProcessDirectCommand = detectProcessDirectCommand(sourceFile);

    if (hasFsDirectImport && !fsAllow.has(relPath)) {
      violations.push({ filePath: relPath, reason: 'fs-direct-import' });
    }

    if (hasGitDirectCommand && !gitAllow.has(relPath)) {
      violations.push({ filePath: relPath, reason: 'git-direct-command' });
    }

    if (hasProcessDirectCommand && !processAllow.has(relPath)) {
      violations.push({ filePath: relPath, reason: 'process-direct-command' });
    }
  }

  return violations;
}

function detectFsDirectImport(sourceFile: ts.SourceFile): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (FS_MODULES.has(node.moduleSpecifier.text)) {
        found = true;
        return;
      }
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      FS_MODULES.has(node.moduleReference.expression.text)
    ) {
      found = true;
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      FS_MODULES.has(node.arguments[0].text)
    ) {
      found = true;
      return;
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      FS_MODULES.has(node.arguments[0].text)
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function detectGitDirectCommand(sourceFile: ts.SourceFile): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'command') ||
        (ts.isStringLiteral(node.name) && node.name.text === 'command')) &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === 'git'
    ) {
      found = true;
      return;
    }

    if (ts.isCallExpression(node) && isGitSpawnCall(node)) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function detectProcessDirectCommand(sourceFile: ts.SourceFile): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (isProcessModuleImport(node)) {
      found = true;
      return;
    }

    if (isBunProcessCall(node)) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function isProcessModuleImport(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return PROCESS_MODULES.has(node.moduleSpecifier.text);
  }

  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return PROCESS_MODULES.has(node.moduleReference.expression.text);
  }

  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    return PROCESS_MODULES.has(node.arguments[0].text);
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    return PROCESS_MODULES.has(node.arguments[0].text);
  }

  return false;
}

function isBunProcessCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (!ts.isIdentifier(node.expression.expression)) return false;
  if (node.expression.expression.text !== 'Bun') return false;
  return BUN_PROCESS_APIS.has(node.expression.name.text);
}

function isGitSpawnCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  const firstArg = node.arguments[0];
  if (!firstArg || !ts.isStringLiteral(firstArg) || firstArg.text !== 'git') {
    return false;
  }

  if (ts.isIdentifier(callee)) {
    return GIT_SPAWN_CALLS.has(callee.text);
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return GIT_SPAWN_CALLS.has(callee.name.text);
  }

  return false;
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
