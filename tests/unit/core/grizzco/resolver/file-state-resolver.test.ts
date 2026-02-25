import * as fs from 'fs/promises';
import * as path from 'path';

import { FileStatus } from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { FileStateResolver } from '../../../../../src/core/strata/layers/file-state-resolver.js';

// Mock dependencies
mock.module('fs/promises', () => ({
  lstat: mock(),
  stat: mock(),
  readFile: mock(),
  open: mock(),
}));
describe('FileStateResolver', () => {
  let resolver: FileStateResolver;
  let mockGit: any;
  const workspaceRoot = '/mock/root';

  beforeEach(() => {
    mock.clearAllMocks();
    mockGit = {
      getStatus: mock(),
      show: mock(),
      checkIgnore: mock().mockResolvedValue(false),
    };
    resolver = new FileStateResolver(mockGit as any, workspaceRoot);

    // Default fs mocks
    (fs.lstat as any).mockResolvedValue({ isSymbolicLink: () => false });
    (fs.stat as any).mockResolvedValue({ size: 1024 });
    (fs.readFile as any).mockResolvedValue(Buffer.from(''));
    // Mock binary detection (default to text)
    (fs.open as any).mockResolvedValue({
      read: mock().mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(8192) }),
      close: mock().mockResolvedValue(undefined),
    });
  });

  describe('Status Parsing (git status --porcelain=v2)', () => {
    it('should resolve UNTRACKED files (?)', async () => {
      mockGit.getStatus.mockResolvedValue('? src/new-file.ts');

      const state = await resolver.resolve('src/new-file.ts');

      expect(state.status).toBe(FileStatus.UNTRACKED);
      expect(state.path).toBe('src/new-file.ts');
      expect(state.absolutePath).toBe(path.join(workspaceRoot, 'src/new-file.ts'));
    });

    it('should resolve STAGED_MODIFIED (1 M.)', async () => {
      mockGit.getStatus.mockResolvedValue('1 M. N... 100644 100644 100644 h1 h2 src/staged.ts');

      const state = await resolver.resolve('src/staged.ts');

      expect(state.status).toBe(FileStatus.STAGED_MODIFIED);
    });

    it('should resolve UNSTAGED_MODIFIED (1 .M)', async () => {
      mockGit.getStatus.mockResolvedValue('1 .M N... 100644 100644 100644 h1 h2 src/modified.ts');

      const state = await resolver.resolve('src/modified.ts');

      expect(state.status).toBe(FileStatus.UNSTAGED_MODIFIED);
    });

    it('should resolve MM (Double Dirty) (1 MM)', async () => {
      mockGit.getStatus.mockResolvedValue('1 MM N... 100644 100644 100644 h1 h2 src/double.ts');

      // Setup mocks for MM content capture
      mockGit.show.mockResolvedValue(Buffer.from('staged content'));
      (fs.readFile as any).mockImplementation(() =>
        Promise.resolve(Buffer.from('working content')),
      );

      const state = await resolver.resolve('src/double.ts');

      expect(state.status).toBe(FileStatus.MM);
      expect(state.stagedContent?.toString()).toBe('staged content');
      expect(state.workingContent?.toString()).toBe('working content');
    });

    it('should resolve CONFLICT (u ...)', async () => {
      mockGit.getStatus.mockResolvedValue(
        'u UU N... 100644 100644 100644 100644 h1 h2 h3 src/conflict.ts',
      );

      const state = await resolver.resolve('src/conflict.ts');

      expect(state.status).toBe(FileStatus.CONFLICT);
    });
  });

  describe('Binary Detection', () => {
    it('should detect binary files via null bytes', async () => {
      mockGit.getStatus.mockResolvedValue('1 .M ... src/image.png');

      const binaryBuffer = Buffer.alloc(8192);
      binaryBuffer[10] = 0x00;

      (fs.open as any).mockResolvedValue({
        read: mock().mockResolvedValue({ bytesRead: 100, buffer: binaryBuffer }),
        close: mock().mockResolvedValue(undefined),
      });

      const state = await resolver.resolve('src/image.png');
      expect(state.isBinary).toBe(true);
    });
  });

  describe('Symlink Detection', () => {
    it('should detect symlinks', async () => {
      mockGit.getStatus.mockResolvedValue('1 .M ... src/link');
      (fs.lstat as any).mockResolvedValue({ isSymbolicLink: () => true });

      const state = await resolver.resolve('src/link');
      expect(state.isSymlink).toBe(true);
    });
  });
});
