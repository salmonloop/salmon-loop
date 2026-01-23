/**
 * ShadowDriver - Layer 2 Dependency Environment Manager
 *
 * Responsibilities:
 * - Prepare dependency environments for ShadowMergeEngine
 * - Manage dependency lifecycle (build, readonly lock, cleanup, fallback)
 * - Implement Safe by Default -> Fast if Possible -> Fallback on Failure strategy
 *
 * @packageDocumentation
 */

export * from './strategy.js';
export * from './error-classifier.js';
export * from './copy-backend.js';
export * from './readonly-lock.js';
export * from './env.js';
export * from './shadow-driver.js';
