import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { promises as fs, constants } from 'fs';
import * as path from 'path';

import { FileAdapter } from '../../../../../src/core/adapters/fs/file-adapter.js';

// Mock fs module
mock.module('fs', () => {
  return {
    promises: {
      readFile: mock(),
      writeFile: mock(),
      appendFile: mock(),
      access: mock(),
      realpath: mock(),
      readdir: mock(),
      stat: mock(),
      mkdir: mock(),
    },
    constants: {
      R_OK: 4,
      W_OK: 2,
    },
  };
});

// Mock AtomicFileWriter
const mockWriteAtomic = mock();
const mockDeleteAtomic = mock();

mock.module('../../../../../src/core/adapters/fs/atomic-file-writer.js', () => {
  return {
    AtomicFileWriter: mock().mockImplementation(() => {
      return {
        writeAtomic: mockWriteAtomic,
        deleteAtomic: mockDeleteAtomic,
      };
    }),
  };
});

describe('FileAdapter', () => {
  let adapter: FileAdapter;

  beforeEach(() => {
    // Reset all mocks
    mock.restore();

    // Explicitly reset our atomic mock instances
    mockWriteAtomic.mockClear();
    mockDeleteAtomic.mockClear();

    adapter = new FileAdapter();
  });

  describe('readFile', () => {
    it('should delegate to fs.readFile with default utf-8 encoding', async () => {
      (fs.readFile as any).mockResolvedValueOnce('file content');

      const result = await adapter.readFile('/path/to/file.txt');

      expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.txt', 'utf-8');
      expect(result).toBe('file content');
    });

    it('should delegate to fs.readFile with provided encoding', async () => {
      (fs.readFile as any).mockResolvedValueOnce('file content');

      const result = await adapter.readFile('/path/to/file.txt', 'base64');

      expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.txt', 'base64');
      expect(result).toBe('file content');
    });
  });

  describe('writeFile', () => {
    it('should create directory recursively and write file', async () => {
      (fs.mkdir as any).mockResolvedValueOnce(undefined);
      (fs.writeFile as any).mockResolvedValueOnce(undefined);

      await adapter.writeFile('/path/to/file.txt', 'new content');

      expect(fs.mkdir).toHaveBeenCalledWith('/path/to', { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith('/path/to/file.txt', 'new content', 'utf-8');
    });
  });

  describe('writeFileAtomic', () => {
    it('should delegate to atomicWriter.writeAtomic', async () => {
      const buffer = Buffer.from('atomic content');
      mockWriteAtomic.mockResolvedValueOnce(undefined);

      await adapter.writeFileAtomic('/path/to/atomic.txt', buffer);

      expect(mockWriteAtomic).toHaveBeenCalledWith('/path/to/atomic.txt', buffer);
    });
  });

  describe('appendFile', () => {
    it('should create directory recursively and append to file', async () => {
      (fs.mkdir as any).mockResolvedValueOnce(undefined);
      (fs.appendFile as any).mockResolvedValueOnce(undefined);

      await adapter.appendFile('/path/to/log.txt', 'log entry\n');

      expect(fs.mkdir).toHaveBeenCalledWith('/path/to', { recursive: true });
      expect(fs.appendFile).toHaveBeenCalledWith('/path/to/log.txt', 'log entry\n', 'utf-8');
    });
  });

  describe('exists', () => {
    it('should return true if access succeeds', async () => {
      (fs.access as any).mockResolvedValueOnce(undefined);

      const result = await adapter.exists('/path/to/existing.txt');

      expect(fs.access).toHaveBeenCalledWith('/path/to/existing.txt');
      expect(result).toBe(true);
    });

    it('should return false if access fails', async () => {
      (fs.access as any).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await adapter.exists('/path/to/missing.txt');

      expect(fs.access).toHaveBeenCalledWith('/path/to/missing.txt');
      expect(result).toBe(false);
    });
  });

  describe('realpath', () => {
    it('should delegate to fs.realpath', async () => {
      (fs.realpath as any).mockResolvedValueOnce('/real/path/file.txt');

      const result = await adapter.realpath('/symlink/file.txt');

      expect(fs.realpath).toHaveBeenCalledWith('/symlink/file.txt');
      expect(result).toBe('/real/path/file.txt');
    });
  });

  describe('readdir', () => {
    it('should delegate to fs.readdir', async () => {
      const files = ['file1.txt', 'file2.txt'];
      (fs.readdir as any).mockResolvedValueOnce(files);

      const result = await adapter.readdir('/path/to/dir');

      expect(fs.readdir).toHaveBeenCalledWith('/path/to/dir');
      expect(result).toEqual(files);
    });
  });

  describe('readdirWithTypes', () => {
    it('should delegate to fs.readdir with withFileTypes: true', async () => {
      const dirents = [{ name: 'file1.txt', isFile: () => true }];
      (fs.readdir as any).mockResolvedValueOnce(dirents);

      const result = await adapter.readdirWithTypes('/path/to/dir');

      expect(fs.readdir).toHaveBeenCalledWith('/path/to/dir', { withFileTypes: true });
      expect(result).toEqual(dirents as any);
    });
  });

  describe('stat', () => {
    it('should delegate to fs.stat', async () => {
      const stats = { isFile: () => true, size: 1024 };
      (fs.stat as any).mockResolvedValueOnce(stats);

      const result = await adapter.stat('/path/to/file.txt');

      expect(fs.stat).toHaveBeenCalledWith('/path/to/file.txt');
      expect(result).toEqual(stats as any);
    });
  });

  describe('mkdir', () => {
    it('should delegate to fs.mkdir with recursive: true', async () => {
      (fs.mkdir as any).mockResolvedValueOnce(undefined);

      await adapter.mkdir('/path/to/new/dir');

      expect(fs.mkdir).toHaveBeenCalledWith('/path/to/new/dir', { recursive: true });
    });
  });

  describe('deleteFile', () => {
    it('should delegate to atomicWriter.deleteAtomic', async () => {
      mockDeleteAtomic.mockResolvedValueOnce(undefined);

      await adapter.deleteFile('/path/to/file.txt');

      expect(mockDeleteAtomic).toHaveBeenCalledWith('/path/to/file.txt');
    });
  });

  describe('access', () => {
    it('should delegate to fs.access with default modes', async () => {
      (fs.access as any).mockResolvedValueOnce(undefined);

      await adapter.access('/path/to/file.txt');

      // Default is constants.R_OK | constants.W_OK
      expect(fs.access).toHaveBeenCalledWith('/path/to/file.txt', constants.R_OK | constants.W_OK);
    });

    it('should delegate to fs.access with provided mode', async () => {
      (fs.access as any).mockResolvedValueOnce(undefined);

      await adapter.access('/path/to/file.txt', constants.R_OK);

      expect(fs.access).toHaveBeenCalledWith('/path/to/file.txt', constants.R_OK);
    });
  });
});
