import { Buffer } from 'node:buffer';

import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import type { ContextResult } from '../types.js';

import { ContextCacheError, type ContextCacheErrorCode } from './errors.js';

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

export interface PersistentContextCacheStoreOptions {
  strict?: boolean;
  fallbackMode?: 'fail' | 'memory';
  cleanupFn?: (details: { filePath: string; error: Error }) => Promise<void>;
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
  private readonly cleanupFn?: (details: { filePath: string; error: Error }) => Promise<void>;
  private readonly fallbackMode: 'fail' | 'memory';
  private degradedToMemory = false;

  constructor(filePath: string, options?: PersistentContextCacheStoreOptions) {
    this.filePath = filePath;
    this.strict = options?.strict ?? false;
    this.cleanupFn = options?.cleanupFn;
    this.fallbackMode = options?.fallbackMode ?? 'fail';
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
      await this.handleLoadFailure(error);
    }
  }

  private async handleLoadFailure(error: unknown): Promise<void> {
    const normalized = this.normalizeError(error);
    const code: ContextCacheErrorCode = this.isCorruptError(normalized)
      ? 'CONTEXT_CACHE_CORRUPT'
      : 'CONTEXT_CACHE_IO';
    const remediation = this.getRemediationMessage(code);
    const contextError = new ContextCacheError(
      code,
      this.filePath,
      remediation,
      `Failed to load context cache: ${normalized.message}`,
      normalized,
    );
    this.recordLoadFailureAudit(contextError, normalized);
    await this.attemptCleanup(normalized);
    const shouldThrow = this.strict || this.fallbackMode === 'fail';
    if (shouldThrow) {
      throw contextError;
    }
    if (this.fallbackMode === 'memory') {
      this.degradedToMemory = true;
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error ?? 'Unknown context cache error'));
  }

  private isCorruptError(error: Error): boolean {
    const lower = error.message.toLowerCase();
    return (
      error instanceof SyntaxError ||
      lower.includes('unexpected token') ||
      lower.includes('invalid or unexpected') ||
      lower.includes('json')
    );
  }

  private getRemediationMessage(code: ContextCacheErrorCode): string {
    return `持久化缓存 ${this.filePath} 可能损坏或权限不足，错误码 ${code}。请删除该文件或切换为内存缓存后重试。`;
  }

  private recordLoadFailureAudit(contextError: ContextCacheError, underlying: Error): void {
    recordAuditEvent(
      'context.cache.load_failure',
      {
        code: contextError.code,
        filePath: this.filePath,
        fallbackMode: this.fallbackMode,
        remediation: contextError.remediation,
        error: underlying.message,
      },
      { source: 'context.cache', severity: 'high', scope: 'repo', phase: 'CONTEXT' },
    );
  }

  private async attemptCleanup(error: Error): Promise<void> {
    if (!this.cleanupFn) return;
    try {
      await this.cleanupFn({ filePath: this.filePath, error });
    } catch (cleanupError) {
      const normalizedCleanup =
        cleanupError instanceof Error
          ? cleanupError
          : new Error(String(cleanupError ?? 'Unknown cleanup error'));
      this.recordCleanupFailure(normalizedCleanup);
    }
  }

  private recordCleanupFailure(error: Error): void {
    recordAuditEvent(
      'context.cache.cleanup_failure',
      {
        filePath: this.filePath,
        error: error.message,
      },
      { source: 'context.cache', severity: 'medium', scope: 'repo', phase: 'CONTEXT' },
    );
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
    if (this.degradedToMemory) return;

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
