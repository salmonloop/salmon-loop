import { text } from '../../../locales/index.js';
import type { FileSystem } from '../../types/index.js';

/**
 * FileSystem adapter that blocks write operations.
 */
export class ReadOnlyFileSystem implements FileSystem {
  constructor(private readonly realFs: FileSystem) {}

  async readFile(path: string, encoding?: string): Promise<string> {
    return this.realFs.readFile(path, encoding);
  }

  async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error(text.grizzco.errors.readOnlyFileSystem('writeFile'));
  }

  async exists(path: string): Promise<boolean> {
    return this.realFs.exists(path);
  }

  async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    throw new Error(text.grizzco.errors.readOnlyFileSystem('mkdir'));
  }
}
