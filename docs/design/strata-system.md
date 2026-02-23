# StrataSystem Architecture (Implementation-Aligned)

StrataSystem is SalmonLoop's layered execution-environment architecture. It separates "environment provisioning (deps/sandbox)" from "logic computation (merge/apply-back)" so we can stay auditable and safe on native hosts (Windows/macOS/Linux).

Note: the repository currently does **not** ship a single `StrataSystem` class. Instead, the architecture is implemented as composable modules (L1/L2/L3) and orchestrated by higher-level flows (e.g. SalmonLoop's `worktree` strategy and apply-back pipeline).

## Layers and Code Mapping

- **L1: ImmutableGitLayer (Git base layer)**
  - Goal: provide a reproducible, Git-backed baseline (snapshots/worktrees).
  - Code: `src/core/strata/layers/immutable-git-layer.ts` (`ImmutableGitLayerImpl`), built on `src/core/strata/checkpoint/manager.ts`.

- **L2: ShadowDriver (dependency environment layer)**
  - Goal: hydrate dependency directories (e.g. `node_modules/target/build`) into a shadow/worktree without touching `.git`, so verification commands can run.
  - Code: `src/core/strata/layers/shadow-driver/*`.
  - **Dependency Linking (L2 Hydration)**:
    - **Architecture**: Orchestrated by `RuntimeEnvironment`, implemented by `ShadowDriver.hydrate`.
    - **Mechanism**: Detects and symlinks dependency directories (for example `node_modules`, `venv`, `target`, `vendor`) from the main repo to the worktree.
    - **Isolation**: Keeps `WorkspaceManager` (L1) focused on Git workspace setup while ensuring the execution environment has required dependencies.
    - **Compatibility**: Uses cross-platform symlinks (`junction` on Windows).

- **L3: SyntheticSidecarLayer (ignored/private files layer)**
  - Goal: optionally provide a synthetic base and injection for ignored/untracked files to avoid unsafe 2-way overwrite merges.
  - Code: `src/core/strata/layers/sidecar-layer.ts` (`SyntheticSidecarLayerImpl`).

## Core Contracts (with ShadowMergeEngine)

- **Source is Truth**: Git (L1) is the trusted source of truth. L2 must never copy/link/modify `.git`. L3 only participates when explicitly requested.
- **No capture by default**: sidecar capture is an explicit input-driven operation (e.g. the caller provides `.env` via `contextFiles`). Without explicit inputs, sidecar should not do extra I/O.
- **Rollback semantics for ignored/untracked**:
  - If the run modified ignored/untracked files, rollback should revert those modifications.
  - If the run did not touch them, rollback must not include them.

## L2 ShadowDriver Design Notes (Implementation-Aligned)

- **Safe by Default**: defaults to `ISOLATED` (physical isolation/copy). Optimizations require explicit whitelist + read-only mode.
- **One-shot Fallback**: at most one downgrade retry to prevent infinite loops.
- **Linux readonly-lock lifecycle**: cleanup must restore write permissions before removing directories.
- **Scoped environment-error detection**: `ENOENT` is only treated as an environment failure when it clearly points to dependency/toolchain paths; otherwise it's likely a real application error.

## How to Use (Recommended)

### Via CLI (Orchestrated by SalmonLoop)

In most cases you do not call L1/L2/L3 directly. The CLI orchestrates worktree creation, verification execution, and rollback:

- `-cs worktree`: run in a temporary worktree (safer, tolerates a dirty main workspace).
- `--worktree-prepare <cmd>`: dependency preparation inside the worktree (e.g. `bun install --frozen-lockfile`).
- `--apply-back-on-dirty stash|abort`: policy when applying back to a dirty main workspace.

### Using ShadowDriver Directly (only if you need external orchestration)

```ts
import os from 'os';
import { ShadowDriver } from '../../src/core/strata/layers/shadow-driver/shadow-driver.js';

const driver = new ShadowDriver({
  repoRoot: '/abs/path/to/repo',
  shadowRoot: '/abs/path/to/shadow',
  platform: os.platform() as any,
  readonly: true,
  dependencyPaths: ['node_modules'],
  whitelist: ['bun run test'],
});

await driver.run({ command: 'bun run test', mode: 'test_readonly' });
await driver.cleanup();
```

### Using SidecarLayer Directly (explicit capture for ignored/untracked)

```ts
import { SyntheticSidecarLayerImpl } from '../../src/core/strata/layers/sidecar-layer.js';

const sidecar = new SyntheticSidecarLayerImpl('/abs/path/to/repo');
await sidecar.capture(['.env', 'local.config.json']);
await sidecar.inject('/abs/path/to/shadow');
```
