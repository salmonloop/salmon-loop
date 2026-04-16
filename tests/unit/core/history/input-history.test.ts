import { join } from 'path';

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Mock FileAdapter before importing the target class
const mkdirMock = mock();
const readFileMock = mock();
const writeFileMock = mock();

mock.module('../../../../src/core/adapters/fs/index.js', () => ({
  FileAdapter: class {
    mkdir = mkdirMock;
    readFile = readFileMock;
    writeFile = writeFileMock;
  },
}));

import { InputHistoryManager } from '../../../../src/core/history/input-history.js';

describe('InputHistoryManager', () => {
  const repoPath = '/fake/repo';
  const sessionId = 'session-123';
  const expectedStorageDir = join(repoPath, '.salmonloop', 'ui-history');
  const expectedFilePath = join(expectedStorageDir, `${sessionId}.json`);
  let manager: InputHistoryManager;

  beforeEach(() => {
    manager = new InputHistoryManager(repoPath);
    mkdirMock.mockClear();
    readFileMock.mockClear();
    writeFileMock.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  describe('init', () => {
    it('should create the storage directory', async () => {
      await manager.init();
      expect(mkdirMock).toHaveBeenCalledWith(expectedStorageDir);
      expect(mkdirMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('load', () => {
    it('should return parsed history when file exists and contains valid JSON', async () => {
      const mockHistory = ['cmd1', 'cmd2'];
      readFileMock.mockResolvedValueOnce(JSON.stringify(mockHistory));

      const result = await manager.load(sessionId);

      expect(readFileMock).toHaveBeenCalledWith(expectedFilePath);
      expect(result).toEqual(mockHistory);
    });

    it('should return empty array on read error (e.g., file not found)', async () => {
      readFileMock.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      const result = await manager.load(sessionId);

      expect(readFileMock).toHaveBeenCalledWith(expectedFilePath);
      expect(result).toEqual([]);
    });

    it('should return empty array on invalid JSON', async () => {
      readFileMock.mockResolvedValueOnce('invalid json');

      const result = await manager.load(sessionId);

      expect(readFileMock).toHaveBeenCalledWith(expectedFilePath);
      expect(result).toEqual([]);
    });
  });

  describe('append', () => {
    it('should append valid input and persist it', async () => {
      readFileMock.mockResolvedValueOnce(JSON.stringify(['old-cmd']));

      await manager.append(sessionId, 'new-cmd');

      expect(writeFileMock).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify(['old-cmd', 'new-cmd'], null, 2),
      );
    });

    it('should trim input before appending', async () => {
      readFileMock.mockResolvedValueOnce(JSON.stringify(['old-cmd']));

      await manager.append(sessionId, '  new-cmd  ');

      expect(writeFileMock).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify(['old-cmd', 'new-cmd'], null, 2),
      );
    });

    it('should ignore empty string', async () => {
      await manager.append(sessionId, '');

      expect(readFileMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should ignore whitespace string', async () => {
      await manager.append(sessionId, '   ');

      expect(readFileMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should ignore slash commands', async () => {
      await manager.append(sessionId, '/help');

      expect(readFileMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should ignore consecutive duplicate commands', async () => {
      readFileMock.mockResolvedValueOnce(JSON.stringify(['cmd1', 'cmd2']));

      await manager.append(sessionId, 'cmd2');

      expect(readFileMock).toHaveBeenCalledTimes(1);
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should allow duplicate commands if not consecutive', async () => {
      readFileMock.mockResolvedValueOnce(JSON.stringify(['cmd1', 'cmd2']));

      await manager.append(sessionId, 'cmd1');

      expect(writeFileMock).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify(['cmd1', 'cmd2', 'cmd1'], null, 2),
      );
    });

    it('should respect maxHistory limit by truncating older items', async () => {
      const maxHistory = 500;
      const initialHistory = Array.from({ length: maxHistory }, (_, i) => `cmd${i}`);
      readFileMock.mockResolvedValueOnce(JSON.stringify(initialHistory));

      await manager.append(sessionId, 'new-cmd');

      // The new history should have exactly 500 items, with the first item removed and 'new-cmd' at the end
      const expectedHistory = [...initialHistory.slice(1), 'new-cmd'];

      expect(writeFileMock).toHaveBeenCalledWith(
        expectedFilePath,
        JSON.stringify(expectedHistory, null, 2),
      );
    });
  });
});
