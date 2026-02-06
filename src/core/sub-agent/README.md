# Sub-agent subsystem

The `src/core/sub-agent` package hosts the Smallfry sub-agent framework, including lifecycle coordination (`core/manager.ts`), status tracking (`controller.ts`), artifact helpers, and the CLI-facing slash command that exposes observability controls.

## Key pieces

- **`SubAgentController`** keeps an in-memory `SubAgentView` per launched agent. It tracks metadata (`id`, `profile`, `status`, timestamps), buffers the last ~50 log lines, and records whether a stop request was issued. cli commands (`/smallfry`) read from this controller to render the list/info/log output and to enqueue polite cancellations. The controller is intentionally read-only except for `requestStop`.
- **`SubAgentManager`** lives in `core/manager.ts`. Whenever a Smallfry is dispatched it registers the agent with `SubAgentController`, updates status/summary (`hiring` → `working` → `done`), and feeds back logs + stop flags from the runtime environment. The manager shields the main worktree by running Smallfrys in isolated `RuntimeEnvironment`s and by obeying the `toolRuntimeCtx` execution contract.
- **CLI surface**: `src/cli/commands/subagent.ts` parses `/smallfry` (aliases `/subagent`, `/sub-agent`) with the verbs `list`, `info`, `log`, and `stop`. Suggestions are provided dynamically from `SubAgentController.listAgents()`, so the Omni-Tray only lists active IDs once a verb that requires an ID has been entered. `/smallfry log` supports `tail=<n>` (max 50) for recent entries. The CLI emits localized strings from `src/cli/locales/en.ts` to keep user-facing text consistent.

## Lifecycle

1. `SmallfryLoop` executes with an `InitCtx` provided by `SubAgentManager`. While running the loop, `SubAgentManager` keeps the `SubAgentController` snapshot in sync (status updates, summaries, logs).
2. `/smallfry list` and `/smallfry info <id>` read this snapshot to show the user a current view of the fleet. `/smallfry log <id>` streams the latest buffered log lines while `tail=` lets humans inspect recent events.
3. `/smallfry stop <id>` marks the controller flag and triggers a graceful cancellation inside `SubAgentManager` (the controller remains the observability gate; the actual stop logic still lives with `SubAgentManager` and `SmallfryLoop`).

## Visibility rules

- The CLI command registry sorts slash commands by each command’s `order` value (`src/cli/commands/registry.ts`). Higher-priority commands are shown earlier in the Omni‑Tray suggestions.
- Commands marked `hidden: true` (like `/parallel`) remain executable but are excluded from suggestions so the UI stays focused. `/exit` exposes `/quit` as an alias for backwards compatibility while still keeping the command itself visible.

Documenting each area here keeps developers aligned on how the CLI surface, controller, and manager collaborate without hitting the user's main worktree.
