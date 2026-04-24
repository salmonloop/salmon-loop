1. Add `processInBatches` utility.
  - Implement a generic `processInBatches` function in `src/core/utils/batch.ts`.
  - Export it for use in other files.
2. Refactor `ChatSessionManager.loadLast` and `ChatSessionManager.load` to use `processInBatches`.
  - Replace `await Promise.all(jsonFiles.map(...))` with `await processInBatches(jsonFiles, 10, ...)`.
  - Replace `await Promise.all(prefixMatches.map(...))` with `await processInBatches(prefixMatches, 10, ...)`.
3. Add a unit test for `processInBatches`.
  - Create a test file `tests/unit/utils/batch.test.ts` to verify batch processing logic.
4. Run formatting, linting, and tests.
  - Run `bun run format`, `bun run lint`, and `bun test` to ensure correctness.
5. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
6. Submit the PR.
  - Create a PR titled "⚡ Bolt: Refactor ChatSessionManager file operations with processInBatches utility".
