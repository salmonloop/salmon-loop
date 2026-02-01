import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(__dirname, '../tests');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Regex to find relative imports that don't end in .js or .json
  // Handles ' and " quotes
  const importRegex = /(import\s+.*?from\s+['"])((\.|\.\.)\/[^'"]+)(['"])/g;

  const newContent = content.replace(importRegex, (match, prefix, pathPart, quote) => {
    // If it already has an extension, ignore (simplified check)
    if (
      pathPart.endsWith('.js') ||
      pathPart.endsWith('.json') ||
      pathPart.endsWith('.ts') ||
      pathPart.endsWith('.tsx')
    ) {
      return match;
    }
    changed = true;
    return `${prefix}${pathPart}.js${quote}`;
  });

  if (changed) {
    console.log(`Fixed imports in ${filePath}`);
    fs.writeFileSync(filePath, newContent);
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      processFile(fullPath);
    }
  }
}

console.log('Scanning tests directory...');
walk(testsDir);
console.log('Done.');
