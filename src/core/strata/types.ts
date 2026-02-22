/**
 * StrataSystem Types and Interfaces
 *
 * This file defines the core types and interfaces for the StrataSystem architecture.
 * All types are exported for use across L1, L2, and L3 layers.
 */

/**
 * Platform type definition
 */
export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * ShadowDriver Strategy Types
 */
export type Strategy = 'ISOLATED' | 'OPTIMIZED' | 'AGGRESSIVE';

/**
 * Task Mode Types
 */
export type TaskMode = 'analysis' | 'test' | 'run' | 'test_readonly';

/**
 * Shadow Task Interface
 */
export interface ShadowTask {
  command: string;
  mode: TaskMode;
  requiresWrite?: boolean;
  forceIsolation?: boolean;
}

/**
 * ShadowDriver Configuration
 */
export interface ShadowDriverConfig {
  whitelist?: string[];
  dependencyPaths: string[];
  readonly: boolean;
  platform: Platform;
  repoRoot: string;
  shadowRoot: string;
}

/**
 * Shadow Environment Result
 */
export interface ShadowEnvResult {
  shadowPath: string;
  strategy: Strategy;
  fallbackApplied: boolean;
  readonlyLocked: boolean;
  dependencyPaths: string[];
}

/**
 * ImmutableGitLayer Interface
 */
export interface ImmutableGitLayer {
  snapshot(): Promise<string>;
  checkout(shadowPath: string, commitHash: string): Promise<void>;
  getFile(path: string): Promise<Buffer | null>;
}

/**
 * SyntheticSidecarLayer Interface
 */
export interface SyntheticSidecarLayer {
  capture(paths: string[]): Promise<void>;
  inject(shadowPath: string): Promise<void>;
  has(path: string): boolean;
  get(path: string): Promise<Buffer | null>;
  clear(): Promise<void>;
}

/**
 * ShadowDriver Interface
 */
export interface ShadowDriver {
  setup(task: ShadowTask): Promise<ShadowEnvResult>;
  cleanup(): Promise<void>;
}

/**
 * Base Provider Interface for ShadowMergeEngine
 */
export interface IBaseProvider {
  getBaseContent(relativePath: string): Promise<Buffer | null>;
}

/**
 * ShadowMergeEngine Options
 * (Removed to avoid duplication with engine/shadow-merge-engine.ts if it exports it)
 * Actually, shadow-merge-engine.ts defines ShadowMergeEngineOptions.
 * We should remove it from here if it is duplicate.
 */
// export interface ShadowMergeEngineOptions { ... }
// Checking if it is here.

/**
 * Default ShadowDriver Configuration
 */
export const DEFAULT_SHADOW_DRIVER_CONFIG: ShadowDriverConfig = {
  whitelist: [],
  dependencyPaths: [],
  readonly: false,
  platform: process.platform as 'win32' | 'darwin' | 'linux',
  repoRoot: '',
  shadowRoot: '',
};

/**
 * Write Operation Blacklist
 * Commands that trigger write operations and require ISOLATED strategy
 */
export const WRITE_OP_BLACKLIST = [
  'install',
  'update',
  'add',
  'remove',
  'build',
  'compile',
  'bun install',
  'bun add',
  'npm i',
  'yarn add',
  'cargo build',
  'cargo run',
  'go mod',
  'go get',
  'pip install',
  'pipenv install',
];

/**
 * Content Guardian Interface
 * Defines the contract for content safety inspection and normalization.
 */
export interface IContentGuardian {
  inspect(content: Buffer): {
    normalized: string;
    eol: '\n' | '\r\n';
    isBinary: boolean;
    size: number;
  };
  restore(text: string, targetEOL: '\n' | '\r\n'): Buffer;
}

/**
 * File System Provider Interface
 * Defines the contract for safe file reading respecting the "Disk First" strategy.
 */
export interface IFileSystemProvider {
  /**
   * Reads the "Yours" version of a file for 3-way merge.
   * STRICTLY reads from physical disk to handle MM (Double Dirty) scenarios correctly.
   */
  readYours(repoPath: string, relativePath: string): Promise<Buffer | null>;

  /**
   * Reads a file as Buffer, handling errors gracefully.
   * Returns null if file doesn't exist.
   */
  readFileBufferSafe(filePath: string, rootContext?: string): Promise<Buffer | null>;

  /**
   * Writes content to a file.
   */
  writeFile(filePath: string, content: Buffer | string, rootContext?: string): Promise<void>;

  /**
   * Creates a directory recursively.
   */
  mkdir(dirPath: string, options?: { recursive?: boolean }, rootContext?: string): Promise<void>;

  /**
   * Deletes a file.
   */
  unlink(filePath: string, rootContext?: string): Promise<void>;

  /**
   * Checks if a file is binary.
   */
  isBinary(filePath: string, rootContext?: string): Promise<boolean>;
}

/**
 * Transaction Manager Interface
 * Defines the contract for atomic Git operations.
 */
export interface ITransactionManager {
  runAtomicOperation<T>(
    repoPath: string,
    operation: () => Promise<T>,
    options?: { message?: string },
  ): Promise<T>;
}
