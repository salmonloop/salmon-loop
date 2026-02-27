import { Buffer } from 'node:buffer';

import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import type { ContextResult } from '../types.js';

export interface ContextCacheEntry {
  result: ContextResult;
  trackedFiles: string[];
  signature: string;
  targetSetSignature?: string;
  intentSignature: string;
  createdAt?: number;
  lastAccessedAt?: number;
}

export interface ContextCacheStore {
  get(key: string): Promise<ContextCacheEntry | undefined>;
  set(key: string, entry: ContextCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  entries(): Promise<Array<[string, ContextCacheEntry]>>;
  size(): Promise<number>;
  clear(): Promise<void>;
}

export class MemoryContextCacheStore implements ContextCacheStore {
  private readonly map = new Map<string, ContextCacheEntry>();

  async get(key: string): Promise<ContextCacheEntry | undefined> {
    return this.map.get(key);
  }

  async set(key: string, entry: ContextCacheEntry): Promise<void> {
    this.map.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async entries(): Promise<Array<[string, ContextCacheEntry]>> {
    return [...this.map.entries()];
  }

  async size(): Promise<number> {
    return this.map.size;
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

interface PersistentPayload {
  version: 1;
  entries: Record<string, ContextCacheEntry>;
}

export class PersistentContextCacheStore implements ContextCacheStore {
  private readonly filePath: string;
  private readonly fileAdapter = new FileAdapter();
  private readonly map = new Map<string, ContextCacheEntry>();
  private readonly strict: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(filePath: string, options?: { strict?: boolean }) {
    this.filePath = filePath;
    this.strict = options?.strict ?? false;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadFromDisk();
    }
    await this.initPromise;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await this.fileAdapter.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistentPayload;
      if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') return;
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (!value || typeof value !== 'object') continue;
        this.map.set(key, value);
      }
    } catch (error) {
      if (this.isNotFoundError(error)) return;
      if (this.strict) {
        throw new Error(
          `Failed to load context cache from ${this.filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const maybeCode = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    if (maybeCode === 'ENOENT') return true;
    const maybeMessage =
      'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
    return maybeMessage.includes('ENOENT');
  }

  private async flushToDisk(): Promise<void> {
    const payload: PersistentPayload = {
      version: 1,
      entries: Object.fromEntries(this.map.entries()),
    };
    await this.fileAdapter.writeFileAtomic(
      this.filePath,
      Buffer.from(JSON.stringify(payload), 'utf-8'),
    );
  }

  async get(key: string): Promise<ContextCacheEntry | undefined> {
    await this.ensureLoaded();
    return this.map.get(key);
  }

  async set(key: string, entry: ContextCacheEntry): Promise<void> {
    await this.ensureLoaded();
    this.map.set(key, entry);
    await this.flushToDisk();
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.map.delete(key)) return;
    await this.flushToDisk();
  }

  async entries(): Promise<Array<[string, ContextCacheEntry]>> {
    await this.ensureLoaded();
    return [...this.map.entries()];
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.map.size;
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.map.clear();
    await this.flushToDisk();
  }
}
