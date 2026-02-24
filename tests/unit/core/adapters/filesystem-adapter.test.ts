import { beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  createFileSystemAdapter,
  ReadOnlyFileSystem,
} from '../../../../src/core/adapters/fs/index.js';
import type { FileSystem, FlowMode } from '../../../../src/core/types/index.js';

describe('createFileSystemAdapter', () => {
  let mockRealFs: FileSystem;

  beforeEach(() => {
    mockRealFs = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      mkdir: vi.fn(),
    };
  });

  it('returns a ReadOnlyFileSystem for review mode', () => {
    const fsAdapter = createFileSystemAdapter('review' as FlowMode, mockRealFs);
    expect(fsAdapter).toBeInstanceOf(ReadOnlyFileSystem);
  });

  it('returns the real filesystem for patch mode', () => {
    const fsAdapter = createFileSystemAdapter('patch' as FlowMode, mockRealFs);
    expect(fsAdapter).toBe(mockRealFs);
  });

  it('returns the real filesystem for debug mode', () => {
    const fsAdapter = createFileSystemAdapter('debug' as FlowMode, mockRealFs);
    expect(fsAdapter).toBe(mockRealFs);
  });
});
