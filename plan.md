1. Add `processInBatches` util into `src/core/utils/batch.ts`.
2. Refactor `src/core/session/manager.ts` (`loadAllSessions`, `listArchivedSessions`, `resolveArchiveFilename`) to use the batch processing logic for file operations to avoid unbounded concurrency and EMFILE errors.
3. Replace direct `Promise.all` that loops through arbitrarily large lists of files with `processInBatches` to enforce a limit on open files.
