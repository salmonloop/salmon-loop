import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const distPath = path.join(process.cwd(), 'dist');
  await fs.rm(distPath, { recursive: true, force: true });
}

await main();
