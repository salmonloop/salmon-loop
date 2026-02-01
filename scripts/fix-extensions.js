import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'src');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        fileList.push(filePath);
      }
    }
  });
  return fileList;
}

const files = getAllFiles(srcDir);
let modifiedCount = 0;

files.forEach((filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);

  // Regex to match imports/exports with relative paths
  // Matches: from "..." or from '...'
  // Captures: 1: opening quote, 2: path, 3: closing quote
  const regex = /from\s+(['"])(\.|\.\.)\/([^'"]+)(['"])/g;

  const newContent = content.replace(regex, (match, quote, dotPart, pathPart, closingQuote) => {
    const fullPath = `${dotPart}/${pathPart}`;

    // Skip if already ends in .js
    if (fullPath.endsWith('.js')) {
      return match;
    }

    // Skip if it ends in .json or .css or other known extensions (optional, but safe)
    if (fullPath.endsWith('.json') || fullPath.endsWith('.css')) {
      return match;
    }

    // Try to resolve
    const absolutePathBase = path.resolve(dir, fullPath);

    // Check for file existence with extensions
    const extensions = ['.ts', '.tsx', '.d.ts', '.js', '.jsx'];
    let foundFile = false;
    for (const ext of extensions) {
      if (fs.existsSync(absolutePathBase + ext)) {
        foundFile = true;
        break;
      }
    }

    // Check for directory index
    let foundIndex = false;
    if (
      !foundFile &&
      fs.existsSync(absolutePathBase) &&
      fs.statSync(absolutePathBase).isDirectory()
    ) {
      for (const ext of extensions) {
        if (fs.existsSync(path.join(absolutePathBase, 'index' + ext))) {
          foundIndex = true;
          break;
        }
      }
    }

    if (foundIndex) {
      // It's a directory import that needs /index.js
      // But if the user strictly asked to just append .js to what's there...
      // "Apply a bulk fix to append .js to these imports"
      // If I change './foo' to './foo/index.js', I am changing the structure of the import, not just appending.
      // However, './foo.js' will fail for a directory.
      // Let's assume standard TS resolution mapping:
      // import './foo' (resolves to foo/index.ts) -> import './foo/index.js'
      return `from ${quote}${fullPath}/index.js${closingQuote}`;
    }

    // Default: append .js
    return `from ${quote}${fullPath}.js${closingQuote}`;
  });

  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Updated: ${filePath}`);
    modifiedCount++;
  }
});

console.log(`Finished processing. Modified ${modifiedCount} files.`);
