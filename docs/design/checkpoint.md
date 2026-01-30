# Checkpoint Strategy & Lifecycle

## Overview

SalmonLoop uses a robust **Checkpoint Strategy** to enable safe, isolated execution of AI-generated patches while strictly adhering to the **"Source is Truth"** principle.

This means:
1.  **Isolation**: AI modifications run in a disposable "Shadow Worktree", never polluting the user's primary workspace until verified.
2.  **Fidelity**: The shadow environment is an *exact* replica of the user's current state, including **staged changes**, **unstaged changes**, and **untracked files**.
3.  **Stability**: We bypass filesystem race conditions (especially on Windows) by reading directly from the Git Object Database.

## Core Concepts

### 1. Snapshot
A **Snapshot** is a temporary, dangling Git commit that captures the exact state of the user's workspace at a specific point in time.
- It captures the **Index** (Staged changes).
- It captures the **Worktree** (Unstaged changes).
- It captures **Untracked Files** (by temporarily adding them to a separate index).

### 2. Shadow Worktree
A **Shadow Worktree** is an ephemeral working directory created from a Snapshot. It serves as the sandbox for the AI Agent.

## Lifecycle

### 1. Capture (Snapshot Creation)
When a task starts:
1.  **Stash Protection**: (Optional) Existing stashes are preserved.
2.  **Index Capture**: The current index is written to a tree object.
3.  **Worktree Capture**: Unstaged changes are effectively "committed" into the snapshot (without modifying the user's actual history).
4.  **Untracked Capture**: Untracked files are added to the snapshot commit.
5.  **Result**: A `commitHash` is returned, representing the total state.

### 2. Isolation (Shadow Restoration)
The `CheckpointManager` restores the snapshot into a new Worktree:
1.  `git worktree add <path> <snapshotHash>`
2.  **Filesystem Sync**: Runs `git update-index -q --refresh` to ensure the new worktree's index matches its disk state immediately. This prevents "false dirty" states.

### 3. Execution (Direct Object Reading)
During the AI's execution loop, reading files relies on the **Git Object Database** instead of the filesystem:
- **Problem**: On Windows, filesystem caches can return stale data immediately after a checkout.
- **Solution**: `CheckpointManager.readSnapshotFile()` reads content directly from the snapshot's blob (`git show <hash>:<file>`).
- **Benefit**: Zero latency, 100% data consistency, immune to OS caching issues.

### 4. Apply Back (Merge & Update)
When the task is complete and verified:
1.  **Diff Generation**: A patch is generated between the Shadow Worktree's final state and the *original* Snapshot.
2.  **Application**: The patch is applied to the Main Workspace.
    - If the user has modified files in the meantime, standard Git merge conflict resolution applies.
    - Staged/Unstaged distinction is respected where possible.

## Safety Mechanisms

1.  **Read-Only Main Workspace**: The main workspace is never touched until the final Apply Back phase.
2.  **Cleanup**: Shadow worktrees are automatically cleaned up after execution to save disk space.
    - **Note**: Snapshots (Git commits) persist in `.git/refs/s8p/snapshots/` to allow manual inspection or restoration. Use `s8p snap clear` to remove them.
3.  **Timeout Protection**: All Git operations have strict timeouts.
4.  **Ignored Files**: The system respects `.gitignore` but allows explicit inclusion of ignored files if requested by the user.
