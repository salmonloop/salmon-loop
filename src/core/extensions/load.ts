import { ZodSchema } from 'zod';

import { syncFs as fs } from '../adapters/fs/node-fs.js';

export interface LoadResult<T> {
  path: string;
  config: T;
}

export class ExtensionConfigError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`Extension config ${path}: ${message}`);
    this.name = 'ExtensionConfigError';
  }
}

export async function tryLoadJsonFile(
  path: string,
): Promise<{ exists: false } | { exists: true; json: unknown }> {
  try {
    const contents = await fs.readFile(path, 'utf-8');
    return { exists: true, json: JSON.parse(contents) };
  } catch (error: unknown) {
    if (
      (error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined) === 'ENOENT'
    ) {
      return { exists: false };
    }
    throw new ExtensionConfigError(
      path,
      (error instanceof Error ? error.message : String(error)) || 'Unable to read file',
    );
  }
}

export async function loadConfig<T>(
  path: string,
  schema: ZodSchema<T>,
): Promise<LoadResult<T> | null> {
  const loaded = await tryLoadJsonFile(path);
  if (!loaded.exists) return null;
  try {
    const config = schema.parse(loaded.json);
    return { path, config };
  } catch (error: unknown) {
    throw new ExtensionConfigError(
      path,
      (error instanceof Error ? error.message : String(error)) || 'Schema validation failed',
    );
  }
}
