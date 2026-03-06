# 跨平台路径测试指南

本文档总结了在 Windows、Linux 和 macOS 上处理文件路径的最佳实践和测试模式。

## 核心原则

### 1. 始终规范化路径以保持一致性

- 使用 `normalizePath()` 将所有路径转换为使用正斜杠 (`/`)
- 这确保了跨平台的一致字符串匹配和模式匹配

### 2. 使用提供的工具函数

项目提供了跨平台路径工具函数，位于 `src/core/utils/path.ts`：

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

// ✅ 好：使用工具函数
const path = safeJoin('src', 'components', 'Button.tsx');
const normalized = normalizePath(userInput);

// ❌ 坏：直接路径拼接
const path = 'src' + '/' + 'components'; // 不要这样做
```

### 3. Blob 路径的模式匹配

匹配 blob 路径时，使用跨平台正则表达式模式：

```typescript
// ✅ 好：匹配 Windows 和 Unix 路径
const blobPattern = /^blobs[\\/]/;
expect(path).toMatch(blobPattern);

// ❌ 坏：只匹配 Unix 路径
const unixPattern = /^blobs\//;
```

### 4. 测试路径模式

测试路径相关代码时，应包含：

```typescript
import { normalizePath } from '../../../src/core/utils/path.js';

describe('跨平台路径模式', () => {
  it('处理 blob 路径模式匹配', () => {
    const posixPath = 'blobs/tool-outputSummary.log';
    const windowsPath = 'blobs\\tool-outputSummary.log';
    const mixedPath = 'blobs\\subdir/file.log';

    const blobPattern = /^blobs[\\/]/;
    expect(blobPattern.test(posixPath)).toBe(true);
    expect(blobPattern.test(windowsPath)).toBe(true);
    expect(blobPattern.test(mixedPath)).toBe(true);
  });

  it('在模式匹配前规范化路径', () => {
    const windowsPath = 'blobs\\tool-outputSummary.log';
    const normalized = normalizePath(windowsPath);

    // 规范化后，使用简单模式
    expect(normalized).toMatch(/^blobs\//);
  });
});
```

## 常见路径模式

### Blob 存储路径

```typescript
// 匹配 blob 路径的模式（跨平台）
const blobPattern = /^blobs[\\/]/;

// 测试用例：
const testPaths = [
  'blobs/file.log', // Unix
  'blobs\\file.log', // Windows
  'blobs\\subdir\\file.log', // Windows 嵌套
  'blobs/subdir/file.log', // Unix 嵌套
];
```

### 路径遍历保护

```typescript
// 始终验证用户提供的路径
function validatePath(userPath: string): string {
  if (!isSafeRelativePath(userPath)) {
    throw new Error('无效路径');
  }
  return normalizePath(userPath);
}

// 路径遍历的测试用例：
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

## 路径工具函数参考

| 函数 | 描述 | 示例 |
|----------|-------------|---------|
| `normalizePath(path)` | 将所有分隔符转换为 `/` | `normalizePath('a\\b\\c')` → `'a/b/c'` |
| `safeJoin(...paths)` | 用 `/` 连接路径 | `safeJoin('a', 'b')` → `'a/b'` |
| `safeResolve(...paths)` | 解析为绝对路径 | `safeResolve('src')` → `'/cwd/src'` |
| `safeRelative(from, to)` | 获取相对路径 | `safeRelative('/a', '/a/b')` → `'b'` |
| `safeDirname(path)` | 获取目录名 | `safeDirname('a/b.ts')` → `'a'` |
| `isSafeRelativePath(path)` | 验证路径安全性 | `isSafeRelativePath('../x')` → `false` |
| `ensureInSandbox(root, target)` | 确保路径在根目录内 | 如果在沙盒外则抛出异常 |
| `isPathWithinDirectory(root, target)` | 检查目标是否在根目录内 | 返回布尔值 |

## 测试检查清单

编写路径相关测试时，确保覆盖：

- [ ] **Unix 风格路径** (`/home/user/file.txt`)
- [ ] **Windows 风格路径** (`C:\Users\user\file.txt`)
- [ ] **混合分隔符** (`src\components/index.ts`)
- [ ] **UNC 路径** (`\\server\share\file.txt`)
- [ ] **相对路径** (`./src/index.ts`, `../parent/file.txt`)
- [ ] **路径遍历尝试** (`../../etc/passwd`)
- [ ] **空路径** (`''`)
- [ ] **带空格的路径** (`my project/src/index.ts`)
- [ ] **Unicode 路径** (`项目/文件.ts`, `プロジェクト/ファイル.ts`)
- [ ] **Emoji 路径** (`😀/test.ts`)

## 迁移指南

### 从原生 `path` 模块迁移

```typescript
// 之前
import path from 'path';
const result = path.join('src', 'index.ts');

// 之后
import { safeJoin } from './core/utils/path.js';
const result = safeJoin('src', 'index.ts');
```

### 从字符串拼接迁移

```typescript
// 之前
const blobPath = 'blobs/' + filename;

// 之后
import { safeJoin } from './core/utils/path.js';
const blobPath = safeJoin('blobs', filename);
```

### 从平台特定模式迁移

```typescript
// 之前
const isWindows = process.platform === 'win32';
const pattern = isWindows ? /^blobs\\/ : /^blobs\//;

// 之后
const pattern = /^blobs[\\/]/;
```

## 常见错误

### ❌ 不要：使用平台特定的路径字面量

```typescript
// 坏：只适用于 Unix
const config = {
  blobPath: 'blobs/test.log',
};

// 坏：只适用于 Windows
const config = {
  blobPath: 'blobs\\test.log',
};
```

### ✅ 要：使用规范化路径

```typescript
// 好：适用于所有平台
const blobPath = safeJoin('blobs', 'test.log');
```

### ❌ 不要：使用字符串拼接

```typescript
// 坏
const fullPath = base + '/' + path;
```

### ✅ 要：使用 safeJoin

```typescript
// 好
const fullPath = safeJoin(base, path);
```

## 性能考虑

- 路径规范化很便宜，应该尽早完成
- 在模式匹配或字符串比较之前始终规范化
- 对于批量操作，在开始时规范化一次

## 已修复的问题

### 问题：Windows 路径分隔符不匹配

**现象**：在 Windows 上，blob 路径使用反斜杠 (`blobs\file.log`)，而正则表达式期望正斜杠。

**解决方案**：使用跨平台正则表达式 `/^blobs[\\/]/` 匹配两种路径格式。

**测试文件**：`tests/integration/llm-stub-server.test.ts`

```typescript
// 之前（只在 Unix 上工作）
expect(path).toMatch(/^blobs\//);

// 之后（跨平台）
expect(path).toMatch(/^blobs[\\/]/);
```

## 相关文件

- `src/core/utils/path.ts` - 路径工具函数
- `tests/unit/utils/path.test.ts` - 路径工具测试
- `tests/integration/llm-stub-server.test.ts` - 集成测试中的路径处理示例

## 参见

- [测试指南](./testing-guidelines.md)
- [Windows 兼容性](./windows-compatibility.md)