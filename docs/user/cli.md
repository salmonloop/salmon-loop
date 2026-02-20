# CLI Reference

SalmonLoop provides a command-line interface (`s8p`) for automated code patching.

## Commands

### Interactive Chat (Default)

Enter the interactive chat mode to provide instructions and receive patches in real-time.

#### UI log mode and density

In chat mode, SalmonLoop exposes two UI controls:

- `/mode <quiet|normal|debug>`: controls **how much** output the TUI shows (recommended for new users: `normal`).
- `/config log <full|standard|compact>`: controls **how dense** the TUI renders the output.

Both settings are persisted to the repo config at `<repoRoot>/.salmonloop/config/config.json`.

#### Sub-agent slash command

While in chat mode you can inspect running Smallfry sub-agents without letting the LLM mutate your main worktree:

- `/smallfry list` lists the registered agents (`id | status | role | summary`).
- `/smallfry info <agentId>` shows metadata for a specific agent.
- `/smallfry log <agentId> [tail=<n>]` prints the buffered audit log (max `tail=50`, defaults to 20).
- `/smallfry stop <agentId>` politely requests cancellation; the `SubAgentController` toggles a flag so the manager can abort the agent safely.

The slug `/smallfry` also accepts `/subagent` and `/sub-agent` aliases; suggestions drop in after you type the verb and begin entering the agent ID. The command relies on `SubAgentController` snapshots updated by `SubAgentManager`, so the list/log output reflects the latest state while the manager keeps each Smallfry in an isolated runtime.

Commands marked `hidden: true` (e.g., `/parallel`) stay executable but do not surface in the Omni-Tray suggestions; the command registry orders slashes by their `order` metadata. `/exit` still honors `/quit` as an alias for convenience.

#### Command Interception

For security and clarity, SalmonLoop strictly manages inputs starting with `/` in chat mode:

- **Valid Commands**: Known commands like `/help`, `/exit`, or `/status` are executed immediately.
- **Unknown Commands**: Any other input starting with `/` (including typos or absolute paths) is **blocked** and an error is shown. This prevents the LLM from misinterpreting system commands or leaking sensitive paths into instructions.

```bash
s8p
# or explicitly
s8p chat
```

### Single Run

Execute a single-turn task and exit.

```bash
s8p run --instruction "..." --verify "..."
```

### Context (Build Only)

Builds and prints the assembled context prompt without calling the LLM.

```bash
s8p context -i "..." [-f src/file.ts | -s "..."] [--diff-scope primary|ast_related] [--budget-chars 30000]
```

## Global Options

- `-r, --repo <path>`: Path to the git repository root. Defaults to the current directory.
- `--config <path>`: Path to a SalmonLoop config JSON file (default: `<repoRoot>/.salmonloop/config/config.json`).
- `--no-config-file`: Disable loading the repo config file.
- `--print-config`: Print the resolved config (redacted) and exit.
- `--verbose [level]`: Enable verbose logging (`basic` or `extended`).
- `--stream-output`: Stream LLM responses to the CLI as they arrive.
  - **Behavior**: Real-time display of text deltas during the PLAN phase.
  - **Tool Status**: Reports when a tool starts and completes (e.g., `[TOOL: code_search] Start... Done`).
  - **Safety**: Raw tool payloads and results are **never** streamed to the terminal to prevent sensitive data leakage. Only the tool name and execution status are shown.
  - **Troubleshooting**: If no output appears, ensure your LLM provider supports streaming and that your `SALMONLOOP_API_KEY` is valid.

## Core Options (for Default Run)

- `-i, --instruction <string>`: **(Required)** Instruction for the LLM to follow.
- `-v, --verify <command>`: **(Required)** Verification command to run after applying the patch (e.g., `npm test`, `pytest`).
- `-f, --file <path>`: Path to a specific file to provide as primary context (repo-relative or absolute).
- `-s, --selection <text>`: Direct text selection to provide as context.

## Snapshot Management

SalmonLoop (s8p) includes a robust snapshot system that captures the exact state of your repository (staged + unstaged changes) before execution.

**Alias**: You can use `s8p snap` instead of `s8p snapshot`.

### Create Snapshot

Manually create a snapshot of the current workspace state.

```bash
s8p snap create -m "Backup before refactor"
```

### List Snapshots

List all available snapshots. Alias: `ls`.

```bash
s8p snap ls
```

### Inspect Snapshot

View detailed information. Use `--files` to list all files contained in the snapshot.

```bash
s8p snap show <hash> [--files]
```

### Compare Snapshots

Compare changes between a snapshot and the current workspace, or between two snapshots.

```bash
# Show summary stats
s8p snap diff <hash>

# Show full code diff
s8p snap diff <hash> --code

# Compare two snapshots
s8p snap diff <hash1> <hash2>
```

### View File Content

Read the content of a file directly from a snapshot ("Source is Truth").

```bash
s8p snapshot cat <hash> <file_path>
```

### Export Snapshot

Export the entire content of a snapshot to a directory.

```bash
s8p snapshot export <hash> <target_directory>
```

### Restore Snapshot

Manually restore the workspace to a specific snapshot state. Alias: `checkout`.

```bash
s8p checkout <hash> [--force]
```

### Delete & Clear

Manage snapshot lifecycle. Alias: `rm`.

```bash
# Delete a single snapshot
s8p snap rm <hash>

# Clear ALL snapshots (requires confirmation)
s8p snap clear --force
```

## Execution & Safety Options

- `-cs, --checkpoint-strategy <direct|worktree>`: (Default: `direct`) Checkpoint strategy. `worktree` is safer and ignores dirty state by running in an isolated temporary directory.
- `--apply-back-on-dirty <3way|abort>`: (Default: `3way`) When using `worktree`, choose how to handle a dirty main workspace during apply-back.
- `--worktree-prepare <command>`: Command to run inside the worktree before processing (e.g., `npm ci`).
- `--dry-run`: Generate and validate the patch, but do not apply it to the disk (preview mode).
- `--force-reset`: Force a hard reset (`git reset --hard`) on failure. **Use with caution** as it discards all uncommitted changes.
- `--stream-output`: Emit streaming LLM output during phases that support it (currently PLAN).

### Advanced Options

- `--verbose [level]`: Enable verbose logging with different levels:
  - `basic`: Outputs basic logs and execution steps (default when flag is present).
  - `extended`: Outputs detailed logs, including internal states and debug information.
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

- `SALMONLOOP_API_KEY`: Your LLM provider API key (preferred).
- `S8P_API_KEY`: (Legacy) Fallback for backward compatibility.
- `SALMONLOOP_BASE_URL`: (Optional) Provider base URL (preferred).
- `S8P_BASE_URL`: (Legacy) Base URL alias.
- `SALMONLOOP_MODEL`: (Optional) LLM model to use (preferred).
- `S8P_MODEL`: (Legacy) Model alias.

### UI Environment Variables

- `SALMONLOOP_UI_LOG_MODE`: `quiet|normal|debug` (preferred).
- `SALMONLOOP_UI_MODE`: alias.
