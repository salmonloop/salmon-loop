# Salmon-Loop

[English](README.md) | [简体中文](docs/README.zh-CN.md)

A minimal viable execution loop for automated code patching.

## Philosophy

Salmon-Loop is built on three core principles:

1.  **Patch-First**: All changes are applied via standard unified diffs (`git apply`). This ensures changes are precise, reversible, and reviewable.
2.  **Verify-First**: No change is considered successful without passing a user-provided verification command (e.g., `npm test`).
3.  **Fail-Fast**: If verification fails, the system immediately rolls back changes and reports the error. It does not attempt to "guess" its way out of a broken state without a clear plan.

## Non-Goals

-   **Not an Agent**: Salmon-Loop is a tool for executing specific instructions, not an autonomous agent that explores the codebase indefinitely.
-   **No Refactors**: It is designed for targeted fixes and features, not large-scale architectural refactoring.
-   **No Whole-File Rewrite**: It modifies existing files via patches; it does not rewrite entire files from scratch.

## Usage

### Installation

```bash
pnpm install
pnpm build
```

### Configuration

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and set your `SALMON_API_KEY`. You can also customize `SALMON_BASE_URL` and `SALMON_MODEL`.

### Running the CLI

You can run the CLI directly (the `run` command is default):

```bash
# Using pnpm (recommended for development)
pnpm dev --instruction "fix bug" --verify "npm test"

# Using npx (no build required)
npx tsx src/cli.ts --instruction "fix bug" --verify "npm test"

# Or after building
node dist/cli.js --instruction "fix bug" --verify "npm test"
```

### Options

-   `-i, --instruction <string>`: (Required) Instruction for the changes to be made.
-   `-v, --verify <command>`: (Required) Command to verify the changes (e.g., `npm test`).
-   `-r, --repo <path>`: Path to the repository (default: current directory).
-   `-f, --file <path>`: Path to a specific file to provide as primary context.
-   `-s, --selection <text>`: User selected text for context.
-   `--dry-run`: Generate patches only without applying them.
-   `--verbose`: Print detailed step logs during execution.
-   `--force-reset`: Force a hard reset (`git reset --hard`) on failure. Use with caution as it will discard all uncommitted changes.

### Examples

**1. Basic Usage**

Fix a bug and verify with `npm test`:

```bash
salmon-loop --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

**2. Dry Run**

Generate a patch without applying it, useful for previewing changes:

```bash
salmon-loop --instruction "Add logging to auth service" --verify "npm run build" --dry-run --verbose
```

**3. Targeted Context**

Provide a specific file as context to reduce noise:

```bash
salmon-loop --instruction "Update email validation regex" --verify "jest tests/email.test.ts" --file "src/utils/validation.ts"
```

## Architecture

The core loop consists of the following steps:
1. **Context Building**: Gathers file content, ripgrep search results, and git diffs.
2. **Planning**: Generates a structured plan (JSON) based on instruction and context.
3. **Patching**: Generates a unified diff based on the plan.
4. **Validation**: Checks if the diff is valid and within limits.
5. **Application**: Applies the patch using `git apply --3way`.
6. **Verification**: Runs the user-provided verification command.
7. **Intelligent Convergence**: If verification fails, analyzes the error output to identify failed files and error types (compilation, test, etc.), rolls back changes, shrinks context to relevant files and their dependencies, and retries (up to limit).
8. **Dynamic Feedback**: Passes the previous error message back to the LLM in the next iteration to help it refine the plan and patch.

## Project Structure

-   `src/core`: Contains the execution loop and must not depend on CLI, UI, or editor integrations.
-   `src/cli.ts`: The command-line interface entry point.

## Safety Limits

To prevent accidental damage, Salmon-Loop enforces strict limits:

-   **Max Files Changed**: 2 files per patch.
-   **Max Diff Lines**: 200 lines per patch.
-   **Max Retries**: 2 attempts to fix verification failures.
-   **Context Size**: Limited token window to ensure focused LLM attention.
-   **Unified Diff**: Only accepts valid unified diff format.
-   **No File Operations**: Prohibits file creation, deletion, or renaming to ensure reliable rollbacks.

## License

MIT
