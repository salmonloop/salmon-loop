import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist') {
        walk(filePath, fileList);
      }
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

const files = walk(rootDir);
let fixedCount = 0;

files.forEach((filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Fix .js'; -> .js';
  content = content.replace(/\.js\.\.;/g, ".js';");
  // Fix .js'; -> .js';
  content = content.replace(/\.js\.;/g, ".js';");

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Repaired: ${filePath}`);
    fixedCount++;
  }
});

console.log(`\nRepair complete. Fixed ${fixedCount} files.`);
