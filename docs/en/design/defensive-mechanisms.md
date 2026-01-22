# Defensive Mechanisms

SalmonLoop implements several defensive mechanisms to ensure robustness, stability, and codebase integrity.

## 1. WASM Initialization Barrier

To prevent race conditions during the initialization of the `web-tree-sitter` WASM environment, SalmonLoop uses a state-machine-based initialization barrier in `AstParser`.

- **States**: `Idle`, `Initializing`, `Ready`, `Error`.
- **Mechanism**: A static `initPromise` ensures that multiple concurrent calls to `init()` return the same promise, preventing redundant initialization attempts.
- **Error Recovery**: If initialization fails, the state moves to `Error`, allowing for a retry in subsequent operations.

## 2. File Locking Protocol

To prevent concurrent SalmonLoop instances or other processes from corrupting the repository during a patch-apply-verify cycle, a file locking protocol is implemented in `src/core/git.ts`.

- **Lock File**: `.salmon.lock` is created at the repository root.
- **Atomicity**: Uses `fs.open` with the `wx` flag (exclusive create) to ensure that only one process can acquire the lock.
- **Timeout & Retry**: Processes will wait up to 30 seconds, retrying every 100ms, to acquire the lock.
- **Stale Lock Protection**: Locks older than 5 minutes are automatically considered stale and removed to prevent deadlocks from crashed processes.

## 3. Deep AST Verification

Beyond simple syntax checking, SalmonLoop performs deep AST verification during the `APPLY` phase.

- **Structure Validation**: Recursively scans the patched AST for `ERROR` nodes, which indicate syntax errors that might not be caught by simple line-based checks.
- **Scope Integrity**: Compares the top-level nodes of the original and patched files. It ensures that only the intended target node (e.g., a specific function) was modified, and all other top-level structures remain identical in content and position.
- **Type Protection**: Uses TypeScript type guards to ensure safe traversal of the tree-sitter nodes.

## 4. Path Normalization

To ensure cross-platform compatibility (Windows vs. Linux/macOS), SalmonLoop enforces path normalization.

- **Forward Slashes**: All internal path representations and comparisons use forward slashes (`/`).
- **Safe Utilities**: `src/core/path.ts` provides `safeJoin`, `safeResolve`, and `normalizePath` to wrap Node.js `path` module calls and ensure consistent output.
- **Security Checks**: Strict validation prevents path traversal attacks and ensures all operations are confined within the repository root.

## 5. TOCTOU Defense

Time-of-Check to Time-of-Use (TOCTOU) vulnerabilities are mitigated by:
- **Atomic Git Operations**: Relying on Git's internal locking and index management for file modifications.
- **Post-Apply Validation**: Re-reading and re-parsing files immediately after modification to verify the actual state on disk.

## 6. Shadow Merge Engine

To safely integrate AI-generated patches with potential user changes, SalmonLoop employs a robust "Shadow Merge" strategy (`src/core/merge/shadow-merge.ts`).

- **Isolation**: Merges are performed in a temporary shadow directory, ensuring the working tree is never left in a broken state.
- **3-Way Merge**: Uses Git's 3-way merge algorithm (via `git merge-file`) to intelligently combine the base version, user changes, and AI patches.
- **Conflict Handling**: Automatically detects conflicts. If a clean merge isn't possible, the operation is aborted safely without corrupting user files.
- **Binary & Large File Protection**: Automatically detects and excludes binary files and strictly enforces size limits to prevent performance degradation.
