# Salmon-Loop

[English](README.md) | [简体中文](docs/README.zh-CN.md)

A minimal viable execution loop for automated code patching.

## Design Philosophy

Salmon-Loop is a CLI tool that implements a minimal viable execution loop for automated code patching. It follows the "Plan -> Patch -> Verify" cycle with fail-fast and rollback mechanisms.

Key principles:
- **Patch-only**: Only modifies files via unified diffs.
- **Verify-first**: Requires a verification command to ensure correctness.
- **Fail-fast**: Stops immediately upon unrecoverable errors or verification failures (after retries).
- **Safety**: Limits file changes, diff lines, and context size.

## Usage

### Installation

```bash
pnpm install
pnpm build
```

### Running the CLI

```bash
node dist/cli.js run --instruction "fix bug" --verify "npm test" [options]
```

### Options

- `-i, --instruction <string>`: (Required) Instruction for the changes to be made.
- `-v, --verify <command>`: (Required) Command to verify the changes (e.g., `npm test`).
- `-r, --repo <path>`: Path to the repository (default: current directory).
- `-f, --file <path>`: Path to a specific file to provide as primary context.
- `-s, --selection <text>`: User selected text for context.
- `--dry-run`: Generate patches only without applying them.
- `--verbose`: Print detailed step logs during execution.

### Example

```bash
# Dry run to see what would happen
node dist/cli.js run \
  --instruction "Update the welcome message to 'Hello Universe'" \
  --verify "npm test" \
  --file "src/app.ts" \
  --dry-run \
  --verbose
```

## Architecture

The core loop consists of the following steps:
1. **Context Building**: Gathers file content, ripgrep search results, and git diffs.
2. **Planning**: Generates a structured plan (JSON) based on instruction and context.
3. **Patching**: Generates a unified diff based on the plan.
4. **Validation**: Checks if the diff is valid and within limits.
5. **Application**: Applies the patch using `git apply --3way`.
6. **Verification**: Runs the user-provided verification command.
7. **Retry/Rollback**: If verification fails, rolls back changes, shrinks context, and retries (up to limit).

## Limitations

- Only supports unified diff format patches.
- Max 2 files changed per patch.
- Max 200 lines of diff per patch.
- Max 2 retries.
- Requires `git` and `rg` (ripgrep) installed.

## License

MIT
