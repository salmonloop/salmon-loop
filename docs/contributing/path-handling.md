# Cross-Platform Path Handling Guidelines

This document outlines the best practices for handling file paths in a cross-platform manner (Windows, Linux, macOS).

## Core Principles

### 1. Always Normalize Paths for Consistency
- Use `normalizePath()` to convert all paths to use forward slashes (`/`)
- This ensures consistent string matching and pattern matching across platforms

### 2. Use Provided Utility Functions
The project provides cross-platform path utilities in `src/core/utils/path.ts`:

```typescript
import {
  normalizePath,
  safeJoin,
  safeResolve,
  safeRelative,
  safeDirname,
  isSafeRelativePath,
  ensureInSandbox,
  isPathWithinDirectory,
} from './core/utils/path.js';

// ✅ Good: Use utility functions
const path = safeJoin('src', 'components', 'Button.tsx');
const normalized = normalizePath(userInput);

// ❌ Bad: Direct path concatenation
const path = 'src' + '/' + 'components'; // Don't do this
```

### 3. Pattern Matching for Blob Paths
When matching blob paths, use cross-platform regex patterns:

```typescript
// ✅ Good: Matches both Windows and Unix paths
const blobPattern = /^blobs[\\/]/;
expect(path).toMatch(blobPattern);

// ❌ Bad: Only matches Unix paths
const unixPattern = /^blobs\//;
```

### 4. Testing Path Patterns
When testing path-related code, include:

```typescript
import { normalizePath } from '../../../src/core/utils/path.js';

describe('Cross-platform path patterns', () => {
  it('handles blob path pattern matching', () => {
    const posixPath = 'blobs/tool-outputSummary.log';
    const windowsPath = 'blobs\\tool-outputSummary.log';
    const mixedPath = 'blobs\\subdir/file.log';

    const blobPattern = /^blobs[\\/]/;
    expect(blobPattern.test(posixPath)).toBe(true);
    expect(blobPattern.test(windowsPath)).toBe(true);
    expect(blobPattern.test(mixedPath)).toBe(true);
  });

  it('normalizes paths before pattern matching', () => {
    const windowsPath = 'blobs\\tool-outputSummary.log';
    const normalized = normalizePath(windowsPath);
    
    // After normalization, use simple pattern
    expect(normalized).toMatch(/^blobs\//);
  });
});
```

## Common Path Patterns

### Blob Storage Paths
```typescript
// Pattern for matching blob paths (cross-platform)
const blobPattern = /^blobs[\\/]/;

// Test cases to include:
const testPaths = [
  'blobs/file.log',           // Unix
  'blobs\\file.log',          // Windows
  'blobs\\subdir\\file.log',  // Windows nested
  'blobs/subdir/file.log',    // Unix nested
];
```

### Path Traversal Protection
```typescript
// Always validate user-provided paths
function validatePath(userPath: string): string {
  if (!isSafeRelativePath(userPath)) {
    throw new Error('Invalid path');
  }
  return normalizePath(userPath);
}

// Test cases for path traversal:
const unsafePaths = [
  '../secret.txt',
  '../../etc/passwd',
  '/etc/passwd',
  'C:\\Windows\\system32',
  'src/../../secret.txt',
];

const safePaths = [
  'src/index.ts',
  'components/button.tsx',
  'docs/readme.md',
];
```

## Path Utility Functions Reference

| Function | Description | Example |
|----------|-------------|---------|
| `normalizePath(path)` | Converts all separators to `/` | `normalizePath('a\\b\\c')` → `'a/b/c'` |
| `safeJoin(...paths)` | Joins paths with `/` | `safeJoin('a', 'b')` → `'a/b'` |
| `safeResolve(...paths)` | Resolves to absolute path | `safeResolve('src')` → `'/cwd/src'` |
| `safeRelative(from, to)` | Gets relative path | `safeRelative('/a', '/a/b')` → `'b'` |
| `safeDirname(path)` | Gets directory name | `safeDirname('a/b.ts')` → `'a'` |
| `isSafeRelativePath(path)` | Validates path safety | `isSafeRelativePath('../x')` → `false` |
| `ensureInSandbox(root, target)` | Ensures path is within root | Throws if outside sandbox |
| `isPathWithinDirectory(root, target)` | Checks if target is in root | Returns boolean |

## Testing Checklist

When writing path-related tests, ensure coverage of:

- [ ] **Unix-style paths** (`/home/user/file.txt`)
- [ ] **Windows-style paths** (`C:\Users\user\file.txt`)
- [ ] **Mixed separators** (`src\components/index.ts`)
- [ ] **UNC paths** (`\\server\share\file.txt`)
- [ ] **Relative paths** (`./src/index.ts`, `../parent/file.txt`)
- [ ] **Path traversal attempts** (`../../etc/passwd`)
- [ ] **Empty paths** (`''`)
- [ ] **Paths with spaces** (`my project/src/index.ts`)
- [ ] **Unicode paths** (`项目/文件.ts`, `プロジェクト/ファイル.ts`)
- [ ] **Emoji paths** (`😀/test.ts`)

## Migration Guide

### From Native `path` Module
```typescript
// Before
import path from 'path';
const result = path.join('src', 'index.ts');

// After
import { safeJoin } from './core/utils/path.js';
const result = safeJoin('src', 'index.ts');
```

### From String Concatenation
```typescript
// Before
const blobPath = 'blobs/' + filename;

// After
import { safeJoin } from './core/utils/path.js';
const blobPath = safeJoin('blobs', filename);
```

### From Platform-Specific Patterns
```typescript
// Before
const isWindows = process.platform === 'win32';
const pattern = isWindows ? /^blobs\\/ : /^blobs\//;

// After
const pattern = /^blobs[\\/]/;
```

## Common Pitfalls

### ❌ Don't: Use platform-specific path literals
```typescript
// Bad: Only works on Unix
const config = {
  blobPath: 'blobs/test.log',
};

// Bad: Only works on Windows
const config = {
  blobPath: 'blobs\\test.log',
};
```

### ✅ Do: Use normalized paths
```typescript
// Good: Works on all platforms
const blobPath = safeJoin('blobs', 'test.log');
```

### ❌ Don't: Use string concatenation
```typescript
// Bad
const fullPath = base + '/' + path;
```

### ✅ Do: Use safeJoin
```typescript
// Good
const fullPath = safeJoin(base, path);
```

## Performance Considerations

- Path normalization is cheap and should be done early
- Always normalize before pattern matching or string comparison
- For batch operations, normalize once at the beginning

## Related Files

- `src/core/utils/path.ts` - Path utility functions
- `tests/unit/utils/path.test.ts` - Path utility tests
- `scripts/check-bun-purity.ts` - Example of path normalization usage

## See Also

- [Testing Guidelines](./testing.md)
- [Windows Compatibility](./windows-compatibility.md)