/**
 * Comprehensive fs/promises mock helper for tests
 *
 * This provides a complete mock implementation covering all fs/promises
 * functions used across the codebase.
 *
 * Usage:
 * ```typescript
 * import { setupFsPromisesMock } from '../helpers/fs-promises-mock';
 *
 * vi.mock('fs/promises', () => setupFsPromisesMock());
 * ```
 */

import type { Stats } from 'fs';

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
    readFile: vi.fn().mockResolvedValue(defaultContent),

    // Write operations
    writeFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),

    // Directory operations
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),

    // File operations
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),

    // Metadata operations
    stat: vi.fn().mockResolvedValue(defaultStats as Stats),
    lstat: vi.fn().mockResolvedValue(defaultStats as Stats),
    access: vi.fn().mockResolvedValue(undefined),

    // File handle operations
    open: vi.fn().mockImplementation(async () => {
      const handle = new (await import('events')).EventEmitter() as any;
      handle.close = vi.fn().mockResolvedValue(undefined);
      handle.write = vi.fn().mockResolvedValue({ bytesWritten: 0, buffer: Buffer.from('') });
      handle.read = vi.fn().mockResolvedValue({ bytesRead: 0, buffer: Buffer.from('') });
      handle.stat = vi.fn().mockResolvedValue(defaultStats);
      handle.appendFile = vi.fn().mockResolvedValue(undefined);
      handle.truncate = vi.fn().mockResolvedValue(undefined);
      handle.sync = vi.fn().mockResolvedValue(undefined);
      handle.datasync = vi.fn().mockResolvedValue(undefined);
      handle.chown = vi.fn().mockResolvedValue(undefined);
      handle.chmod = vi.fn().mockResolvedValue(undefined);
      handle.fd = 42;
      return handle;
    }),

    // Symlink operations
    symlink: vi.fn().mockResolvedValue(undefined),
    readlink: vi.fn().mockResolvedValue(''),

    // Permission operations
    chmod: vi.fn().mockResolvedValue(undefined),
    chown: vi.fn().mockResolvedValue(undefined),
  };

  if (useRealFs) {
    return async () => {
      const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
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
  // In Vitest, mocks are reset via vi.clearAllMocks() or vi.resetAllMocks()
  // This function is kept for API compatibility but delegates to Vitest
  vi.resetAllMocks();
}

/**
 * Helper to configure readFile mock with file-specific content
 *
 * Note: This requires the fs/promises module to already be mocked.
 * Call this after vi.mock('fs/promises', setupFsPromisesMock())
 */
export function mockReadFileContent(fileMap: Record<string, string | Buffer>) {
  // Access the already-mocked module
  const mockReadFile = vi.fn().mockImplementation(async (path: any) => {
    const pathStr = typeof path === 'string' ? path : path.toString();

    for (const [pattern, content] of Object.entries(fileMap)) {
      if (pathStr.includes(pattern)) {
        return content;
      }
    }

    return '';
  });

  // Replace the mock implementation
  vi.doMock('fs/promises', async () => {
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    return {
      ...actual,
      readFile: mockReadFile,
    };
  });
}

/**
 * Helper to configure stat mock with file-specific sizes
 *
 * Note: This requires the fs/promises module to already be mocked.
 * Call this after vi.mock('fs/promises', setupFsPromisesMock())
 */
export function mockFileStats(statsMap: Record<string, Partial<Stats>>) {
  const mockStat = vi.fn().mockImplementation(async (path: any) => {
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

  vi.doMock('fs/promises', async () => {
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    return {
      ...actual,
      stat: mockStat,
    };
  });
}

/**
 * Helper to track file system operations for verification
 */
export function createFsOperationTracker() {
  const operations: Array<{
    operation: string;
    path: string;
    args: any[];
    timestamp: number;
  }> = [];

  const track = (operation: string) =>
    vi.fn().mockImplementation(async (...args: any[]) => {
      operations.push({
        operation,
        path: args[0]?.toString() || '',
        args,
        timestamp: Date.now(),
      });
    });

  return {
    operations,
    trackedMocks: {
      readFile: track('readFile').mockResolvedValue(''),
      writeFile: track('writeFile').mockResolvedValue(undefined),
      copyFile: track('copyFile').mockResolvedValue(undefined),
      mkdir: track('mkdir').mockResolvedValue(undefined),
      rm: track('rm').mockResolvedValue(undefined),
      unlink: track('unlink').mockResolvedValue(undefined),
    },
    reset: () => {
      operations.length = 0;
    },
    getOperations: (operationType?: string) => {
      return operationType ? operations.filter((op) => op.operation === operationType) : operations;
    },
  };
}
