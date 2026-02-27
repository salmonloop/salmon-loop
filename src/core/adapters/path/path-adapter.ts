import path from 'node:path';

export interface PathAdapter {
  join(...segments: string[]): string;
  resolve(...segments: string[]): string;
  dirname(filePath: string): string;
  basename(filePath: string): string;
  relative(from: string, to: string): string;
  isAbsolute(filePath: string): boolean;
}

export class NodePathAdapter implements PathAdapter {
  join(...segments: string[]): string {
    return path.join(...segments);
  }

  resolve(...segments: string[]): string {
    return path.resolve(...segments);
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  relative(from: string, to: string): string {
    return path.relative(from, to);
  }

  isAbsolute(filePath: string): boolean {
    return path.isAbsolute(filePath);
  }
}

export const defaultPathAdapter: PathAdapter = new NodePathAdapter();
