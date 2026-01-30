import fs from 'node:fs/promises';
import path from 'node:path';

async function copyDir(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  await fs.cp(srcDir, destDir, { recursive: true });
}

async function main() {
  const repoRoot = process.cwd();
  const templatesSrc = path.join(repoRoot, 'src', 'core', 'prompts', 'templates');
  const templatesDest = path.join(repoRoot, 'dist', 'core', 'prompts', 'templates');

  try {
    await copyDir(templatesSrc, templatesDest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to copy prompt templates: ${msg}`);
  }
}

await main();
