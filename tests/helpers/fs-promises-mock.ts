/**
 * Comprehensive fs/promises mock helper for tests
 *
 * This provides a complete mock implementation covering all fs/promises
 * functions used across the codebase.
 *
 * Usage:
 * ```typescript
 * import { setupFsPromisesMock } from '../helpers/fs-promises-mock.js';
 *
 * mock.module('fs/promises', () => setupFsPromisesMock());
 * ```
 */

import type { Stats } from 'fs';
import { EventEmitter } from 'node:events';

type FsPath = string | Buffer | URL;

interface MockFileHandle extends EventEmitter {
  close: () => Promise<void>;
  write: (buffer: Buffer) => Promise<{ bytesWritten: number; buffer: Buffer }>;
  read: (
    buffer: Buffer | null,
    offset?: number,
    length?: number,
    position?: number,
  ) => Promise<{
    bytesRead: number;
    buffer: Buffer;
  }>;
  stat: () => Promise<Stats>;
  appendFile: (data: string | Buffer) => Promise<void>;
  truncate: () => Promise<void>;
  sync: () => Promise<void>;
  datasync: () => Promise<void>;
  chown: () => Promise<void>;
  chmod: () => Promise<void>;
  fd: number;
}

import { mock } from 'bun:test';

export interface FsPromisesMockOptions {
  /**
   * Use real fs/promises for unmocked functions
   * @default false
   */
  useRealFs?: boolean;

  /**
   * Default file content for readFile
   * @default ''
   */
  defaultContent?: string | Buffer;

  /**
   * Default file stats
   */
  defaultStats?: Partial<Stats>;
}

/**
 * Creates a complete fs/promises mock implementation
 */
export function setupFsPromisesMock(options: FsPromisesMockOptions = {}) {
  const {
    useRealFs = false,
    defaultContent = '',
    defaultStats = {
      size: 1024,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    },
  } = options;

  const mockImplementation = {
    // Read operations
    readFile: mock().mockResolvedValue(defaultContent),

    // Write operations
    writeFile: mock().mockResolvedValue(undefined),
    copyFile: mock().mockResolvedValue(undefined),

    // Directory operations
    mkdir: mock().mockResolvedValue(undefined),
    rm: mock().mockResolvedValue(undefined),
    rmdir: mock().mockResolvedValue(undefined),
    readdir: mock().mockResolvedValue([]),

    // File operations
    unlink: mock().mockResolvedValue(undefined),
    rename: mock().mockResolvedValue(undefined),

    // Metadata operations
    stat: mock().mockResolvedValue(defaultStats as Stats),
    lstat: mock().mockResolvedValue(defaultStats as Stats),
    access: mock().mockResolvedValue(undefined),

    // File handle operations
    open: mock().mockImplementation(async () => {
      const handle = new EventEmitter() as MockFileHandle;
      handle.close = mock().mockResolvedValue(undefined);
      handle.write = mock().mockResolvedValue({ bytesWritten: 0, buffer: Buffer.from('') });
      handle.read = mock().mockResolvedValue({ bytesRead: 0, buffer: Buffer.from('') });
      handle.stat = mock().mockResolvedValue(defaultStats);
      handle.appendFile = mock().mockResolvedValue(undefined);
      handle.truncate = mock().mockResolvedValue(undefined);
      handle.sync = mock().mockResolvedValue(undefined);
      handle.datasync = mock().mockResolvedValue(undefined);
      handle.chown = mock().mockResolvedValue(undefined);
      handle.chmod = mock().mockResolvedValue(undefined);
      handle.fd = 42;
      return handle;
    }),

    // Symlink operations
    symlink: mock().mockResolvedValue(undefined),
    readlink: mock().mockResolvedValue(''),

    // Permission operations
    chmod: mock().mockResolvedValue(undefined),
    chown: mock().mockResolvedValue(undefined),
  };

  if (useRealFs) {
    return async () => {
      const actual = await import('node:fs/promises');
      return {
        ...actual,
        ...mockImplementation,
      };
    };
  }

  return () => mockImplementation;
}

/**
 * Helper to reset all fs/promises mocks to default state
 */
export function resetFsPromisesMocks() {
  // Clear all mock call state so each test can start from a clean baseline.
  mock.restore();
}

/**
 * Helper to configure readFile mock with file-specific content
 *
 * Note: This requires the fs/promises module to already be mocked.
 * Call this after mock.module('fs/promises', setupFsPromisesMock())
 */
export function mockReadFileContent(fileMap: Record<string, string | Buffer>) {
  // Access the already-mocked module
  const mockReadFile = mock().mockImplementation(async (path: FsPath) => {
    const pathStr = typeof path === 'string' ? path : path.toString();

    for (const [pattern, content] of Object.entries(fileMap)) {
      if (pathStr.includes(pattern)) {
        return content;
      }
    }

    return '';
  });

  mock.module('fs/promises', async () => {
    const actual = await import('node:fs/promises');
    return { ...actual, readFile: mockReadFile };
  });
}

/**
 * Helper to configure stat mock with file-specific sizes
 *
 * Note: This requires the fs/promises module to already be mocked.
 * Call this after mock.module('fs/promises', setupFsPromisesMock())
 */
export function mockFileStats(statsMap: Record<string, Partial<Stats>>) {
  const mockStat = mock().mockImplementation(async (path: FsPath) => {
    const pathStr = typeof path === 'string' ? path : path.toString();

    for (const [pattern, stats] of Object.entries(statsMap)) {
      if (pathStr.includes(pattern)) {
        return {
          size: 1024,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          ...stats,
        } as Stats;
      }
    }

    throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  });

  mock.module('fs/promises', async () => {
    const actual = await import('node:fs/promises');
    return { ...actual, stat: mockStat };
  });
}

/**
 * Helper to track file system operations for verification
 */
export function createFsOperationTracker() {
  const operations: Array<{
    operation: string;
    path: string;
    args: unknown[];
    timestamp: number;
  }> = [];

  const track = <T = void>(operation: string) =>
    mock<(...args: unknown[]) => Promise<T>>().mockImplementation(async (...args) => {
      operations.push({
        operation,
        path: String(args[0] ?? ''),
        args,
        timestamp: Date.now(),
      });
      return undefined as T;
    });

  return {
    operations,
    trackedMocks: {
      readFile: track<string>('readFile').mockResolvedValue(''),
      writeFile: track<void>('writeFile').mockResolvedValue(undefined),
      copyFile: track<void>('copyFile').mockResolvedValue(undefined),
      mkdir: track<void>('mkdir').mockResolvedValue(undefined),
      rm: track<void>('rm').mockResolvedValue(undefined),
      unlink: track<void>('unlink').mockResolvedValue(undefined),
    },
    reset: () => {
      operations.length = 0;
    },
    getOperations: (operationType?: string) => {
      return operationType ? operations.filter((op) => op.operation === operationType) : operations;
    },
  };
}
