import { promises as fs } from 'node:fs';
import path from 'node:path';

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsFiles(rootDir, baseDir = rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsFiles(full, baseDir)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.relative(baseDir, full));
    }
  }

  return files;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

async function writeCompatModule(dir2024, relativePath) {
  const target = path.join(dir2024, relativePath);
  const withoutExt = relativePath.replace(/\.js$/, '');
  const requirePath = path.posix.join('..', '2025', toPosixPath(withoutExt));
  const content = `'use strict';\n\nmodule.exports = require('${requirePath}');\n`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

async function main() {
  const root = path.resolve(process.cwd(), 'node_modules', 'es-abstract');
  const dir2024 = path.join(root, '2024');
  const dir2025 = path.join(root, '2025');

  if (!(await fileExists(root)) || !(await fileExists(dir2025))) {
    return;
  }

  await fs.mkdir(dir2024, { recursive: true });

  const entries2025 = await listJsFiles(dir2025);
  const missing = [];

  for (const rel of entries2025) {
    const target = path.join(dir2024, rel);
    if (!(await fileExists(target))) {
      missing.push(rel);
    }
  }

  if (missing.length === 0) {
    return;
  }

  for (const rel of missing) {
    await writeCompatModule(dir2024, rel);
  }
}

main().catch((error) => {
  console.error(`Failed to apply es-abstract compatibility patch: ${error}`);
  process.exitCode = 1;
});
