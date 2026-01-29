// Types
export * from './types.js';

// Checkpoint
export * from './checkpoint/manager.js';

// Engine
// ShadowMergeEngineOptions is exported from types.js as well?
// No, it is defined in engine/shadow-merge-engine.ts
// If types.ts also exports it, we have conflict.
// Let's check src/core/strata/types.ts
export * from './engine/shadow-merge-engine.js';

// Layers
export * from './layers/worktree.js';
export * from './layers/sidecar-layer.js';
export * from './layers/immutable-git-layer.js';
