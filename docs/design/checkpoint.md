# Checkpoint Strategy & Lifecycle

## Overview

SalmonLoop Stage 10 introduces the **Checkpoint Strategy** to enable safe, isolated execution of AI-generated patches without risking the integrity of the user's primary workspace.

The core implementation uses **Git Worktrees** to create ephemeral, disposable environments for the `PLAN` -> `PATCH` -> `APPLY` -> `VERIFY` loop.

## CheckpointRef

The `CheckpointRef` structure defines the contract for an execution environment:

```typescript
export type CheckpointRef = {
  strategy: 'worktree';
  repoPath: string;      // The user's primary repository path
  worktreePath: string;  // The isolated worktree path
  baseRef: string;       // The git reference (commit/HEAD) the worktree is based on
  branchName: string;    // The temporary branch associated with the worktree
};
```

## Lifecycle

### 1. Creation (Preflight)

When SalmonLoop starts with `strategy: 'worktree'` (default in Stage 10):

1.  **Validation**: Ensures `repoPath` is a valid git repository.
2.  **Base Reference**: Captures the current `HEAD` of the primary workspace.
3.  **Path Generation**: Creates a temporary path in `os.tmpdir()`:
    `salmon-loop-wt/<repoName>/<timestamp>-<random>`
4.  **Worktree Creation**:
    Executes `git worktree add --detach <worktreePath> <baseRef>`.
    *Refinement*: We usage `--detach` to avoid creating unnecessary local branches that might pollute the namespace, though checking out a specific temp branch is also supported.
5.  **Context Switching**: The `ExecutionWorkspace` is updated to point to `worktreePath` as the active `workPath`.

### 2. Execution (Loop)

All mutating operations occur within the `worktreePath`:
- `ContextBuilder` reads from the worktree.
- `applyPatch` writes to the worktree.
- `runVerify` executes commands (npm test, etc.) inside the worktree.

**Isolation Guarantee**:
- The primary workspace is strictly Read-Only during this phase.
- "Dirty" states (uncommitted changes) in the primary workspace are ignored/bypassed, as the worktree is based on the committed `HEAD`.

### 3. Cleanup (Teardown)

Regardless of success or failure, the worktree must be cleaned up to release resources.

1.  **Worktree Removal**:
    `git worktree remove --force <worktreePath>`
    - Force is used because we don't care about abandoning uncommitted changes in the temp worktree.
    - **Fallback**: If git command fails (common on Windows due to file locks), we fall back to `rimraf` (node-based recursive delete) to ensure the directory is removed.
2.  **Branch Cleanup**:
    `git branch -D <branchName>` (if a branch was created).

### 4. Apply Back (Success Only)

*To be implemented in Day 3*

Upon successful verification, the changes in the worktree are propagated back to the primary workspace:
1.  Generate patch: `git diff <baseRef>` inside worktree.
2.  Apply patch: `git apply` in primary workspace.

## Safety Mechanisms

1.  **Timeouts**: All git operations are wrapped in `runGit` with a strict timeout (default 15s) to prevent hanging processes.
2.  **Fallback Deletion**: The dual-strategy cleanup (Git -> FS) ensures temporary directories don't accumulate on the user's disk.
3.  **Path Validation**: Worktree paths are strictly namespaced under `salmon-loop-wt` to prevent accidental deletion of user data.
