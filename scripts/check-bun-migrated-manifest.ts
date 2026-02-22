import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIT_ROOT = path.join('tests', 'unit');
const MIGRATED_MANIFEST = path.join('tests', 'bun-migrated-files.json');
const ISOLATED_MANIFEST = path.join('tests', 'bun-isolated-files.json');

async function collectUnitTestFiles(repoRoot: string, rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectUnitTestFiles(repoRoot, fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.test\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    files.push(path.relative(repoRoot, fullPath).replace(/\\/g, '/'));
  }
  return files.sort();
}

async function loadStringArray(repoRoot: string, filePath: string): Promise<string[]> {
  const raw = await readFile(path.join(repoRoot, filePath), 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must be a JSON array`);
  }
  const values = parsed.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (values.length !== parsed.length) {
    throw new Error(`${filePath} must contain only non-empty strings`);
  }
  return values.map((value) => value.replace(/\\/g, '/'));
}

function reportMissing(header: string, files: string[]): void {
  if (files.length === 0) return;
  console.error(`${header} (${files.length}):`);
  for (const file of files) {
    console.error(`- ${file}`);
  }
}

async function main() {
  const repoRoot = process.cwd();
  const unitFiles = await collectUnitTestFiles(repoRoot, path.join(repoRoot, UNIT_ROOT));
  const migrated = await loadStringArray(repoRoot, MIGRATED_MANIFEST);
  const isolated = await loadStringArray(repoRoot, ISOLATED_MANIFEST);

  const unitSet = new Set(unitFiles);
  const migratedSet = new Set(migrated);

  const missingFromMigrated = unitFiles.filter((file) => !migratedSet.has(file));
  const staleInMigrated = migrated.filter((file) => !unitSet.has(file));
  const staleInIsolated = isolated.filter((file) => !unitSet.has(file));
  const isolatedNotMigrated = isolated.filter((file) => !migratedSet.has(file));

  if (
    missingFromMigrated.length ||
    staleInMigrated.length ||
    staleInIsolated.length ||
    isolatedNotMigrated.length
  ) {
    reportMissing('Missing from tests/bun-migrated-files.json', missingFromMigrated);
    reportMissing('Stale entries in tests/bun-migrated-files.json', staleInMigrated);
    reportMissing('Stale entries in tests/bun-isolated-files.json', staleInIsolated);
    reportMissing('Isolated entries not present in migrated manifest', isolatedNotMigrated);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Bun manifest check passed: ${unitFiles.length} unit tests tracked, isolated=${isolated.length}.`,
  );
  if (isolated.length > 0) {
    console.warn(
      `Reminder: tests/bun-isolated-files.json currently has ${isolated.length} entries. Keep it empty unless isolation is required.`,
    );
  }
}

const thisFile = fileURLToPath(import.meta.url);
const entryFile = path.resolve(process.argv[1] || '');
if (entryFile === thisFile) {
  void main();
}
