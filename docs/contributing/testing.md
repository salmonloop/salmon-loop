# Testing Guidelines & Safety Philosophy

This document outlines the testing philosophy and safety guidelines for the Salmon Loop project. Adhering to these principles is critical to preventing data loss and ensuring robust software.

## 1. Core Philosophy: Behavior over Implementation

When writing tests, focus on **Observable Behavior** (what the system does for the user) rather than **Implementation Details** (how the system achieves it internally).

### The Golden Rule

Ask yourself: _"If I refactor the internal code but the output remains the same, will this test pass?"_

- **YES**: Good behavior test.
- **NO**: Brittle implementation test.

### Comparison: Rollback Logic

#### ❌ Bad Test (Implementation Focused)

Asserts that the system performs a specific internal action (reset to HEAD), ignoring user context.

```typescript
it('should rollback file', async () => {
  // Arrange
  await modifyFile('file.ts', 'staged content', true); // User staged this
  await modifyFile('file.ts', 'agent mess'); // Agent messed it up

  // Act
  await rollbackFiles(['file.ts']);

  // Assert - BAD
  // This forces the implementation to destroy the user's staged content!
  expect(content).toBe('original commit content');
});
```

#### ✅ Good Test (Behavior Focused)

Asserts that the system restores the user's asset (staged content) to its rightful state.

```typescript
it('should rollback safely', async () => {
  // Arrange
  await modifyFile('file.ts', 'staged content', true); // User staged this
  await modifyFile('file.ts', 'agent mess'); // Agent messed it up

  // Act
  await rollbackFiles(['file.ts']);

  // Assert - GOOD
  // This allows the implementation to use `git checkout --` (Index) instead of `HEAD`.
  expect(content).toBe('staged content');
});
```

## 2. Safety Baseline (CRITICAL)

The integrity of user data is paramount. The Agent must act as a guest in the user's repository, never a destructive force.

### The "Do No Harm" Rules

1.  **Never delete Staged Changes (`git add`)**: The rollback mechanism must revert to the Index, not HEAD, unless explicitly instructed otherwise.
2.  **Never delete Untracked Files**: Unless the Agent created them itself and knows they are garbage.
3.  **Dirty Workspace Protection**: Before applying complex patches (ApplyBack), the system MUST verify the workspace state or create a backup.

### Verification

All critical safety logic is verified by:

- `tests/integration/rollback_safety.test.ts`

**Rule**: This test suite must **ALWAYS PASS**. It is the last line of defense against data loss.

## 3. API Contracts

### `rollbackFiles(repoPath, files, forceReset?, ref?)`

- **Default Behavior (No ref)**: `git checkout -- <files>`
  - Restores files to the **Index (Staged)** state.
  - **Safe** for user data.
  - Use this for general agent error recovery.

- **Force Reset Behavior (ref='HEAD')**: `git reset --hard HEAD` (or specific ref)
  - Restores files to the **Commit** state.
  - **Destructive** to staged changes.
  - Use this ONLY when the user explicitly requests a "Hard Reset" or "Clean Slate".

## 4. Development Workflow

1.  **Before modifying core git logic**: Run `bun run test tests/integration/rollback_safety.test.ts`.
2.  **When a test fails**:
    - Do not blindly change the production code to satisfy the test.
    - Analyze: _"Is the test asserting a dangerous implementation detail?"_
    - If yes, fix the test, not the code.
3.  **Add Safety Comments**: Use `// CRITICAL SAFETY:` comments in production code to warn future maintainers about load-bearing logic.

## 4.1 Bun Test Runtime

- The project test runtime is `bun test`. Do not use legacy non-Bun test runner commands in development scripts or hooks.
- Run the full suite with `bun run test:full`.
- Unit, integration, and perf tests run via `scripts/run-bun-file-tests.ts` as per-file isolated subprocesses.
- `bun run test:unit` maps to `bun scripts/run-bun-file-tests.ts tests/unit`.

## 5. Testing Best Practices & Golden Rules

### The Testing Pyramid

1.  **Unit Tests (Unit)**: Fast, isolated, test individual functions.
    - **Mock everything external**: No real file system, no network, no `new Date()` (use fake timers).
    - **Focus**: Logic verification.
2.  **Integration Tests (Integration)**: Verify component interaction.
    - **Source is Truth**: Use the real file system (e.g., `RealFsTestHelper`) instead of mocking `fs`. Verify the actual side effects.
    - **Focus**: Correct wiring and side effects.
3.  **End-to-End Tests (E2E)**: Simulate full user workflows.

### Unit Test Rules

- **Determinism**: A test must produce the same result every time. Never rely on system time (`new Date()`) or randomness (`Math.random()`) without mocking.
- **Mock Externalities**: Unit tests must **NEVER** make real network calls, access the real file system, or spawn child processes. All external dependencies must be mocked.
- **Silence**: Tests should produce no console output (`console.log`) during execution. It clutters reports. Use breakpoints for debugging, or remove logs before committing.
- **Isolation**: No test should depend on the state left by a previous test.
- **Boundary Guard**: Run `bun run check:unit-boundary` (or `bun run check:unit-boundary:staged`) to block new unit tests from introducing real filesystem/process mutation. Transitional exceptions must be declared in `tests/unit-boundary-allowlist.json`.

### Integration Test Rules

- **Source is Truth**: When testing file operations, verify the actual file on disk. Do not verify that `fs.writeFile` was called; verify that `fs.readFile` returns the expected content.
- **Clean Slate**: Ensure the environment is reset before each test (use `afterEach(cleanup)`).

### The FIRST Principle

- **F**ast: Tests should run quickly to provide immediate feedback.
- **I**ndependent: Tests should not depend on each other.
- **R**epeatable: Tests should run the same in any environment.
- **S**elf-validating: Tests should have a boolean output (pass/fail).
- **T**imely: Tests should be written alongside or before the code.

## 6. Case Study: Cross-Platform Testing & Constraint Safety

This section documents critical lessons learned from fixing integration tests that failed on Windows due to semantic drift and cross-platform incompatibilities.

### 6.1 The Problem: OS-Level Abstractions Leak

**Original Issue**: Tests used filesystem-level tricks (symlinks) to trigger Git failures, which behaved differently on Windows vs Unix.

```typescript
// ❌ BAD: OS-dependent symlink to trigger failure
await symlink(targetDir, join(worktreePath, 'temp_link'), 'junction');
// Windows: Git treats junction as regular directory, patch succeeds
// Unix: Git rejects symlink over directory, patch fails (as expected)
```

**Root Cause**: The test tried to force a failure using operating system semantics instead of Git's domain semantics. This created semantic drift where the test no longer validated the actual production code path.

### 6.2 The Solution: Domain-Level Conflict Mechanisms

**Fixed Approach**: Use Git's native 3-way merge conflict to trigger rollback, ensuring cross-platform consistency.

```typescript
// ✅ GOOD: Git-native conflict mechanism
await helper.modifyFile(mainRepo, 'conflict.txt', 'user changes');
await helper.modifyFile(worktree, 'conflict.txt', 'ai changes');
// Git apply -3 encounters conflict, writes markers, exits code 1
// This triggers rollback in production code exactly as designed
```

**Key Insight**: Production code (`WorkspaceSynchronizer`) relies on Git protocols. Tests must trigger failures using the same protocols, not OS-level quirks.

### 6.3 Smart Routing Awareness: Hidden Decision Trees

**Critical Discovery**: The system has internal routing logic that chooses between `ExplicitMerge` (tolerates conflicts) and `AtomicPatch` (strict failure on conflicts).

```typescript
// Production code: Smart Routing in analyzeStrategy()
if (['R', 'D', 'A', 'C', 'T'].includes(status)) {
  return ApplyStrategy.AtomicPatch; // Strict mode
}
return ApplyStrategy.ExplicitMerge; // Tolerant mode
```

**Test Implication**: If your patch contains only text modifications, Smart Routing selects `ExplicitMerge`, which purposefully does NOT throw on conflicts. To test rollback, you must force `AtomicPatch` by including a topology change (like adding a new file).

```typescript
// ✅ GOOD: Force AtomicPatch routing
await helper.writeFile(worktree, 'trigger_atomic.txt', 'force strict mode');
await helper.git(worktree, ['add', 'trigger_atomic.txt']);
// Now Smart Routing selects AtomicPatch, which throws on conflict
```

### 6.4 Cross-Platform Command Execution

**Problem**: Inline shell commands (`bun -e "code"`) fail on Windows due to quoting/escaping differences.

**Solution**: Write script files instead of inline commands.

```typescript
// ❌ BAD: Inline command
const verify = bunCommand(`-e "console.error('fail'); process.exit(1)"`);

// ✅ GOOD: Script file
await helper.writeFile(repo, 'fail.ts', "console.error('fail'); process.exit(1);");
const verify = bunCommand('fail.ts');
```

### 6.5 Monitor Initialization: Graceful Degradation

**Problem**: Production code calls `getMonitor()` which throws if Monitor isn't initialized. Tests running without `--preload` crash.

**Solution**: Use `tryGetMonitor()` for optional metrics recording.

```typescript
// Production code change (safe for tests and production)
const monitor = tryGetMonitor();
if (monitor) {
  monitor.recordApplyBack(success, duration);
}
```

**Rationale**: Metrics are observability, not core functionality. The system should work without monitor initialization, especially in test environments.

### 6.6 Validation: Did We Drift From Production?

**Critical Question**: Do these fixes change the semantics being tested?

**Answer**: NO - The fixes actually align tests closer to production:

1. **Rollback Trigger**: Production uses Git exit codes, not OS errors. Tests now use the same.
2. **Conflict Detection**: Production writes `<<<<<<<` markers when conflicts occur. Tests verify these markers are cleaned up by rollback.
3. **Smart Routing**: Tests now correctly navigate the production routing logic instead of bypassing it.

### 6.7 Safety Constraint Verification

**Absolute Safety Requirements**:
- ✅ User's staged changes must survive rollback
- ✅ User's untracked files must survive rollback
- ✅ Conflict markers must be cleaned up after rollback
- ✅ Index state must be preserved (Zero Index Access policy)

**Test Enhancement**: Tests now assert rollback SUCCESS by verifying conflict markers are REMOVED, not just that an error was thrown.

```typescript
// ✅ GOOD: Verify rollback effectiveness
const content = await readFile('conflict.txt');
expect(content).toBe('user original content'); // Clean state
expect(content).not.toContain('<<<<<<<'); // No conflict markers
```

### 6.8 Key Takeaways

1. **Align Triggers with Domain Logic**: Use Git features (merge conflicts) not OS features (symlinks) to test Git-based systems.

2. **Understand Internal Routing**: Know your system's decision trees. Tests must navigate them correctly to hit desired code paths.

3. **Verify Restoration, Not Damage**: When testing rollback, assert that damage is ERASED and user data is RESTORED, not that damage exists.

4. **Cross-Platform Commands**: Avoid inline shell commands. Use script files for portability.

5. **Graceful Degradation**: Optional subsystems (monitoring, logging) should not crash when uninitialized.

6. **Semantic Drift Detection**: Ask "If I refactor production code but keep the same behavior, will this test still pass?" If NO, you're testing implementation details, not behavior.

## 7. Case Study: Avoiding Semantic Drift in Integration Tests

**Semantic Drift** occurs when the test setup (fixtures, pre-conditions) deviates from the actual physical or business semantics that the production code relies on. This often happens when tests try to force an error or edge case using "clever" system-level tricks instead of domain-level mechanisms.

### The Problem: OS-Level Hacks
In an earlier version of our tests, to trigger a mid-apply failure during `git apply` (to test the Rollback mechanism), the test created a directory in the main repo and a symlink with the same name in the patch. 
- **Intent**: Force an `EISDIR` or "Directory not empty" error from the OS to crash `git apply`.
- **Result**: Semantic drift. In Windows, Git treats junctions differently and simply applied the patch inside the directory without throwing an error. The expected crash never occurred, leading to a silent failure of the test's intent (the rollback mechanism was never actually triggered or tested).

### The Solution: Domain-Level Constraints
Production code (`WorkspaceSynchronizer`) relies on Git protocols (specifically `git apply -3` for 3-way merges). The fix was to replace the OS-level symlink trick with a pure Git domain-level mechanism: **a 3-way merge conflict**.

1. **Setup**: Modify the same file differently in both the main repo (dirty/uncommitted) and the worktree (committed).
2. **Trigger**: When `git apply -3` encounters the conflict, it writes `<<<<<<<` markers to the file (achieving a physical mutation/dirty workspace) and exits with code 1.
3. **Smart Routing Awareness**: If a patch contains only text modifications, our `Smart Routing` might choose `ExplicitMerge` (which purposefully tolerates conflicts without throwing an error). To guarantee `AtomicPatch` (which strictly throws on conflicts and triggers the Rollback mechanism), the test intentionally adds a dummy file (`trigger_atomic.txt`) to introduce a topology change (Add), forcing the stricter route.
4. **Assertion**: A successful rollback must *remove* the `<<<<<<<` markers, restoring the file to its exact pre-patch dirty state. Asserting that the markers *exist* after a rollback would mean the rollback failed to clean up the mess!

### Key Takeaways
- **Align Triggers with Domain Logic**: If the system relies on Git, trigger errors using Git features (merge conflicts), not OS file system quirks (symlinks vs junctions).
- **Understand Internal Routing**: Be aware of internal decision trees (like Smart Routing). Your test setup must accurately navigate these routes to hit the desired error-handling branches.
- **Verify Restoration, Not Damage**: When testing rollbacks, assert that the damage (e.g., conflict markers) is completely erased and user data is restored, rather than asserting that the damage is still visible.
