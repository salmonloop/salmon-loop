# CLI Reference

SalmonLoop provides a command-line interface for automated code patching.

## Commands

The `run` command is the default and currently the only command.

```bash
salmon-loop [options]
```

## Options

- `-i, --instruction <string>`: **(Required)** Instruction for the code modification.
- `-v, --verify <command>`: **(Required)** Command to run for verification (e.g., `npm test`, `pytest`).
- `-r, --repo <path>`: Path to the target repository. Defaults to the current directory.
- `-f, --file <path>`: Path to a specific file to provide as primary context (repo-relative or absolute).
- `-s, --selection <text>`: Direct text selection to provide as context.
- `--dry-run`: Generate the patch and run validation, but do not apply it to the disk.
- `--verbose [level]`: Enable verbose logging with different levels:
  - `basic`: Outputs basic logs and execution steps (default when flag is present).
  - `extended`: Outputs detailed logs, including internal states and debug information.
- `--force-reset`: Force a hard reset (`git reset --hard`) on failure. **Use with caution** as it discards all uncommitted changes. Cannot be used with `--allow-dirty`.
- `--allow-dirty`: Allow running SalmonLoop even if the workspace has uncommitted changes. Cannot be used with `--force-reset`.
- `--validate`: Run code quality checks (lint and tests) before starting the loop.
- `--target-node <name>`: The name of the node (e.g., function name) that is allowed to be modified. Enables deep AST scope integrity verification.

## User Experience

### Progress Feedback
SalmonLoop features a visual progress bar that tracks the execution through various phases:
- **Preflight**: Safety checks.
- **Context**: Gathering codebase context.
- **Plan**: Creating the modification plan.
- **Patch**: Generating the unified diff.
- **Validate**: Enforcing safety limits.
- **Apply**: Writing changes to disk.
- **Verify**: Running the verification command.
- **Rollback**: Restoring state on failure.

### Interactive Suggestions
When a loop fails, SalmonLoop provides actionable suggestions based on the failure type:
- **Compilation Errors**: Suggestions to check syntax or imports.
- **Linting Errors**: Suggestions to run local linters.
- **Test Failures**: Guidance to inspect test output.
- **Workspace Safety**: Reminders to commit or stash changes.

## Environment Variables

- `SALMON_API_KEY`: Your LLM provider API key.
- `SALMON_BASE_URL`: (Optional) Custom API base URL.
- `SALMON_MODEL`: (Optional) LLM model to use.
