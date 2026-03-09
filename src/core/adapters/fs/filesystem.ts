import type { FileSystem, FlowMode } from '../../types/index.js';

import { FileAdapter } from './file-adapter.js';
import { ReadOnlyFileSystem } from './readonly-filesystem.js';

class FileAdapterFileSystem implements FileSystem {
  constructor(private readonly adapter: FileAdapter = new FileAdapter()) {}

  async readFile(path: string, encoding: string = 'utf-8'): Promise<string> {
    return this.adapter.readFile(path, encoding as BufferEncoding);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.adapter.writeFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.adapter.exists(path);
  }

  async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    await this.adapter.mkdir(path);
  }
}

/**
 * Creates a FileSystem adapter based on the specified FlowMode.
 * Review mode returns a ReadOnlyFileSystem to block writes.
 */
export function createFileSystemAdapter(
  mode: FlowMode,
  realFs: FileSystem = new FileAdapterFileSystem(),
): FileSystem {
  if (mode === 'review' || mode === 'research' || mode === 'answer') {
    return new ReadOnlyFileSystem(realFs);
  }
  return realFs;
}
