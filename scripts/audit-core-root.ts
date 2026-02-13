import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

import ts from 'typescript';

export interface CoreRootRefsByArea {
  cli: number;
  core: number;
  integrations: number;
  index: number;
  tests: number;
  other: number;
}

export interface CoreRootFileReport {
  path: string;
  inboundRefs: number;
  importers: string[];
  refsByArea: CoreRootRefsByArea;
  orphan: boolean;
  testOnly: boolean;
}

export interface CoreRootAuditSummary {
  rootFileCount: number;
  orphanRootFiles: string[];
  testOnlyRootFiles: string[];
}

export interface CoreRootAuditReport {
  generatedAt: string;
  repoRoot: string;
  rootFiles: CoreRootFileReport[];
  summary: CoreRootAuditSummary;
}

export interface AuditCoreRootOptions {
  repoRoot?: string;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && isSourceFile(fullPath)) {
      out.push(fullPath);
    }
  }

  return out;
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function extractModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specs: string[] = [];

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specs;
}

function emptyRefsByArea(): CoreRootRefsByArea {
  return {
    cli: 0,
    core: 0,
    integrations: 0,
    index: 0,
    tests: 0,
    other: 0,
  };
}

function classifyImporter(relativePath: string): keyof CoreRootRefsByArea {
  if (relativePath.startsWith('src/cli/')) return 'cli';
  if (relativePath.startsWith('src/core/')) return 'core';
  if (relativePath.startsWith('src/integrations/')) return 'integrations';
  if (relativePath === 'src/index.ts') return 'index';
  if (relativePath.startsWith('tests/')) return 'tests';
  return 'other';
}

function toCompilerOptions(repoRoot: string): ts.CompilerOptions {
  return {
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    baseUrl: repoRoot,
    allowImportingTsExtensions: true,
  };
}

export async function auditCoreRoot(
  options: AuditCoreRootOptions = {},
): Promise<CoreRootAuditReport> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const srcDir = path.join(repoRoot, 'src');
  const testsDir = path.join(repoRoot, 'tests');
  const coreDir = path.join(srcDir, 'core');

  const srcFiles = (await walkFiles(srcDir)).map((f) => path.resolve(f));
  const testFiles = (await walkFiles(testsDir).catch(() => [])).map((f) => path.resolve(f));
  const allFiles = [...srcFiles, ...testFiles];

  const rootFiles = (await readdir(coreDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.resolve(coreDir, entry.name))
    .sort();

  const incoming = new Map<string, Set<string>>();
  for (const file of rootFiles) {
    incoming.set(file, new Set<string>());
  }

  const compilerOptions = toCompilerOptions(repoRoot);
  const host = ts.createCompilerHost(compilerOptions, true);

  for (const importer of allFiles) {
    const content = await readFile(importer, 'utf-8');
    const sourceFile = ts.createSourceFile(importer, content, ts.ScriptTarget.ES2022, true);
    const specs = extractModuleSpecifiers(sourceFile);

    for (const spec of specs) {
      const resolved = ts.resolveModuleName(spec, importer, compilerOptions, host).resolvedModule;
      if (!resolved) continue;

      const resolvedPath = path.resolve(resolved.resolvedFileName);
      if (!incoming.has(resolvedPath)) continue;
      if (resolvedPath.endsWith('.d.ts')) continue;

      incoming.get(resolvedPath)?.add(normalizePath(path.relative(repoRoot, importer)));
    }
  }

  const reports: CoreRootFileReport[] = rootFiles.map((filePath) => {
    const importers = Array.from(incoming.get(filePath) ?? []).sort();
    const refsByArea = emptyRefsByArea();

    for (const importer of importers) {
      const area = classifyImporter(importer);
      refsByArea[area] += 1;
    }

    const orphan = importers.length === 0;
    const testOnly =
      importers.length > 0 && importers.every((importer) => importer.startsWith('tests/'));

    return {
      path: normalizePath(path.relative(repoRoot, filePath)),
      inboundRefs: importers.length,
      importers,
      refsByArea,
      orphan,
      testOnly,
    };
  });

  const summary: CoreRootAuditSummary = {
    rootFileCount: reports.length,
    orphanRootFiles: reports.filter((item) => item.orphan).map((item) => item.path),
    testOnlyRootFiles: reports.filter((item) => item.testOnly).map((item) => item.path),
  };

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    rootFiles: reports,
    summary,
  };
}

export function renderAuditText(report: CoreRootAuditReport): string {
  const lines: string[] = [];
  lines.push(`[core-root-audit] repo: ${report.repoRoot}`);
  lines.push(`[core-root-audit] root files: ${report.summary.rootFileCount}`);
  lines.push(`[core-root-audit] orphan root files (${report.summary.orphanRootFiles.length}):`);
  for (const file of report.summary.orphanRootFiles) {
    lines.push(`  - ${file}`);
  }
  lines.push(
    `[core-root-audit] test-only root files (${report.summary.testOnlyRootFiles.length}):`,
  );
  for (const file of report.summary.testOnlyRootFiles) {
    lines.push(`  - ${file}`);
  }

  lines.push('');
  lines.push('Root file inbound refs:');
  for (const file of report.rootFiles) {
    lines.push(`  ${file.inboundRefs.toString().padStart(3, ' ')}  ${file.path}`);
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const report = await auditCoreRoot();

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderAuditText(report)}\n`);
}

export function isExecutedAsMain(moduleUrl: string, argvPath?: string): boolean {
  if (!argvPath) return false;
  const entryUrl = pathToFileURL(path.resolve(argvPath)).href;
  return moduleUrl === entryUrl;
}

if (isExecutedAsMain(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`[core-root-audit] failed: ${message}\n`);
    process.exitCode = 1;
  });
}
