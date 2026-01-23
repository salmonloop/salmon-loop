/**
 * StrataSystem - Layered execution environment for Salmon Loop
 *
 * Architecture:
 * - L1: ImmutableGitLayer - Git snapshot and worktree management
 * - L2: ShadowDriver - Dependency environment preparation and optimization
 * - L3: SyntheticSidecarLayer - Ignored/untracked file handling
 *
 * @packageDocumentation
 */

export * from './types.js';
export * from './layers/immutable-git-layer.js';
export { ShadowDriver } from './layers/shadow-driver/shadow-driver.js';
export * from './layers/sidecar-layer.js';
