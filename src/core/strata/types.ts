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
 */
export interface ShadowMergeEngineOptions {
  worktreePath: string;
  baseProvider: IBaseProvider;
}

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
  'npm i',
  'yarn add',
  'pnpm add',
  'cargo build',
  'cargo run',
  'go mod',
  'go get',
  'pip install',
  'pipenv install',
];
