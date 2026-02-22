# Testing Guidelines & Safety Philosophy

This document outlines the testing philosophy and safety guidelines for the Salmon Loop project. Adhering to these principles is critical to preventing data loss and ensuring robust software.

## 1. Core Philosophy: Behavior over Implementation

When writing tests, focus on **Observable Behavior** (what the system does for the user) rather than **Implementation Details** (how the system achieves it internally).

### The Golden Rule
Ask yourself: *"If I refactor the internal code but the output remains the same, will this test pass?"*
*   **YES**: Good behavior test.
*   **NO**: Brittle implementation test.

### Comparison: Rollback Logic

#### ❌ Bad Test (Implementation Focused)
Asserts that the system performs a specific internal action (reset to HEAD), ignoring user context.
```typescript
it('should rollback file', async () => {
  // Arrange
  await modifyFile('file.ts', 'staged content', true); // User staged this
  await modifyFile('file.ts', 'agent mess');           // Agent messed it up

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
  await modifyFile('file.ts', 'agent mess');           // Agent messed it up

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
*   `tests/integration/rollback_safety.test.ts`

**Rule**: This test suite must **ALWAYS PASS**. It is the last line of defense against data loss.

## 3. API Contracts

### `rollbackFiles(repoPath, files, forceReset?, ref?)`

*   **Default Behavior (No ref)**: `git checkout -- <files>`
    *   Restores files to the **Index (Staged)** state.
    *   **Safe** for user data.
    *   Use this for general agent error recovery.

*   **Force Reset Behavior (ref='HEAD')**: `git reset --hard HEAD` (or specific ref)
    *   Restores files to the **Commit** state.
    *   **Destructive** to staged changes.
    *   Use this ONLY when the user explicitly requests a "Hard Reset" or "Clean Slate".

## 4. Development Workflow

1.  **Before modifying core git logic**: Run `bun run test tests/integration/rollback_safety.test.ts`.
2.  **When a test fails**:
    *   Do not blindly change the production code to satisfy the test.
    *   Analyze: *"Is the test asserting a dangerous implementation detail?"*
    *   If yes, fix the test, not the code.
3.  **Add Safety Comments**: Use `// CRITICAL SAFETY:` comments in production code to warn future maintainers about load-bearing logic.

## 4.1 Bun Test In-Place Migration

- Run migrated Bun-native tests with `bun run test:bun:migrated`.
- Migrated files stay in their original locations (in-place migration), then are excluded from `vitest`.
- This avoids duplicate test files while allowing phased migration from `vitest` to `bun test`.

## 5. Testing Best Practices & Golden Rules

### The Testing Pyramid
1.  **Unit Tests (Unit)**: Fast, isolated, test individual functions.
    *   **Mock everything external**: No real file system, no network, no `new Date()` (use fake timers).
    *   **Focus**: Logic verification.
2.  **Integration Tests (Integration)**: Verify component interaction.
    *   **Source is Truth**: Use the real file system (e.g., `RealFsTestHelper`) instead of mocking `fs`. Verify the actual side effects.
    *   **Focus**: Correct wiring and side effects.
3.  **End-to-End Tests (E2E)**: Simulate full user workflows.

### Unit Test Rules
*   **Determinism**: A test must produce the same result every time. Never rely on system time (`new Date()`) or randomness (`Math.random()`) without mocking.
*   **Mock Externalities**: Unit tests must **NEVER** make real network calls, access the real file system, or spawn child processes. All external dependencies must be mocked.
*   **Silence**: Tests should produce no console output (`console.log`) during execution. It clutters reports. Use breakpoints for debugging, or remove logs before committing.
*   **Isolation**: No test should depend on the state left by a previous test.

### Integration Test Rules
*   **Source is Truth**: When testing file operations, verify the actual file on disk. Do not verify that `fs.writeFile` was called; verify that `fs.readFile` returns the expected content.
*   **Clean Slate**: Ensure the environment is reset before each test (use `afterEach(cleanup)`).

### The FIRST Principle
*   **F**ast: Tests should run quickly to provide immediate feedback.
*   **I**ndependent: Tests should not depend on each other.
*   **R**epeatable: Tests should run the same in any environment.
*   **S**elf-validating: Tests should have a boolean output (pass/fail).
*   **T**imely: Tests should be written alongside or before the code.
