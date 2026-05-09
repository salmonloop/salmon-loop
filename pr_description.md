🎯 **What:** The testing gap addressed
This PR introduces a comprehensive unit test suite for `src/cli/commander-error-adapter.ts`. Previously, the error adapter logic that bridges Commander.js errors to our custom output formatting and exit handling lacked explicit test coverage, making it vulnerable to regressions during refactoring.

📊 **Coverage:** What scenarios are now tested
- **`isCommanderError`**: Verifies identification of proper `CommanderError` instances versus standard errors and non-error primitives.
- **`shouldExitCommanderError`**: Ensures it correctly filters out help-like commands (`commander.helpDisplayed`, `commander.version`) while correctly flagging actual errors (e.g., `commander.unknownOption`, missing codes, non-errors).
- **`getCommanderErrorExitCode`**: Validates extraction of the `exitCode` property with the correct fallback to `1` when missing or for non-error primitives.
- **`emitHeadlessCommanderUsageError`**: Extensively mocks and tests the headless usage error writer integration. Verifies early returns for missing `outputFormat` or help-like errors, correctly formatted calls to `writeUsageError`, handling of default vs. provided `headlessDetection` parameters, and proper generation of reader/writer closures.

✨ **Result:** The improvement in test coverage
The critical error adaptation layer for CLI execution is now fully covered, providing confidence that formatting changes, missing parameters, or unexpected Commander.js error shapes will not cause silent failures or unhandled exceptions in the terminal output.
