# Chat Autopilot Default Design

Date: 2026-04-22

## Context

`autopilot` already exists as a first-class `FlowMode` for the `run` execution kernel, but the main chat product surface still behaves like the older intent-routed system:

- `run` defaults to `patch`
- `chat` routes each turn through `routeChatIntent()`
- chat has no explicit flow-mode state
- existing `/mode` controls `permissionMode`, not `flowMode`

This leaves the new agent-style flow structurally present but not actually first-class from the main user entrypoints.

## Goals

- Make `autopilot` the default execution mode for both `run` and `chat`.
- Keep flow selection explicit in chat instead of classifier-driven.
- Add a dedicated chat command for flow-mode switching.
- Persist chat flow mode in the session so `continue` and `resume` restore it.
- Keep `permissionMode` and `flowMode` as separate concepts.

## Non-Goals

- Expanding repo config schema to add `flowMode` defaults.
- Reworking `serve`, ACP, or A2A mode control in this slice.
- Adding new autopilot tool capabilities such as command execution.
- Replacing or deleting `routeChatIntent()` globally.

## User-Facing Decisions

### Default behavior

- `run` defaults to `autopilot` when `--act-mode` is not provided.
- `chat` starts new sessions in `autopilot`.

### Chat mode selection

- Chat mode switching is explicit only.
- Chat does not automatically switch between `patch`, `review`, `debug`, `research`, `answer`, or `autopilot`.
- A new slash command, `/flow-mode <mode>`, controls the current chat flow mode.

### Session behavior

- Chat flow mode is session-scoped and persisted.
- `continue` and `resume` restore the prior chat flow mode.
- `/new` starts a fresh session that falls back to the default `autopilot`.

### Existing `/mode`

- `/mode` remains permission-mode only.
- It continues to manage `interactive` vs `yolo`.
- It must not be reused or renamed for flow-mode selection.

## Proposed Approach

### 1. Add chat-local flow state

Extend persisted chat session state with a dedicated chat runtime section:

```ts
chatState?: {
  flowMode?: FlowMode;
}
```

This avoids overloading config or permission-mode state and leaves room for future chat-local controls.

### 2. Make chat execution use current session flow mode

Change `src/cli/chat.ts` so each turn runs with:

1. `session.meta.chatState?.flowMode`
2. else `options.defaultFlowMode`
3. else `'autopilot'`

The selected mode becomes the single source of truth for `runSalmonLoop()` calls in chat.

### 3. Remove per-turn flow routing from chat

Stop using `routeChatIntent()` to choose engineering modes in the main chat execution path.

This means:

- no automatic routing to `patch`
- no automatic routing to `review`
- no automatic routing to `debug`
- no automatic routing to `research`
- no automatic routing to `answer`

The current mode remains stable until the user explicitly changes it.

### 4. Add `/flow-mode`

Create a new slash command dedicated to flow-mode switching:

- `/flow-mode`
- `/flow-mode autopilot`
- `/flow-mode review`
- `/flow-mode patch`
- `/flow-mode debug`
- `/flow-mode research`
- `/flow-mode answer`

This command updates only the current chat session state and saves it immediately.

### 5. Change `run` default mode

Adjust run-mode resolution so the implicit default changes from `patch` to `autopilot`, while explicit `--act-mode` still wins.

## Execution and Strategy Semantics

Removing intent routing means chat can no longer infer strategy from a classifier result like "non-mutating".

So chat execution must derive strategy from the resolved flow mode or `ExecutionProfile`, not from intent classification.

Expected behavior:

- `review`, `research`, `answer` keep non-mutating/direct-style execution
- `autopilot` keeps its profile-driven defaults
- other mutable recipe modes continue to use their existing strategy semantics

## Compatibility

- Older sessions will not contain `chatState.flowMode`.
- Missing flow mode is interpreted as `autopilot`.
- Invalid persisted values should degrade safely to `autopilot` with a warning.
- Existing `/mode` behavior remains unchanged.
- `routeChatIntent()` can remain available for other call sites or future use.

## Testing Strategy

### Unit tests

- `resolveRunMode()` defaults to `autopilot`
- run handler uses `autopilot` when no explicit `--act-mode` is passed
- `/flow-mode` accepts valid modes and rejects invalid ones
- chat session persistence restores `chatState.flowMode`
- chat execution no longer uses `routeChatIntent()` for mode selection
- chat still chooses the correct strategy for read-only vs mutable flow modes

### Integration tests

- `run` without `--act-mode` executes with `autopilot`
- chat `continue` / `resume` restores the prior flow mode

## Risks

- Changing `run` default mode is a meaningful product-surface change and may surprise users who assumed implicit `patch`.
- Chat may feel less "smart" at first because implicit mode switching is removed.
- If strategy derivation is not updated carefully, read-only chat modes could accidentally inherit mutable execution defaults.

## Why This Is The Right Slice

This change makes `autopilot` a real first-class product mode without collapsing it into permission policy and without starting an overbroad control-plane refactor.

It keeps the kernel direction already established:

- `flowMode` is execution semantics
- `permissionMode` is authorization semantics
- session state owns chat-local runtime defaults
- `ExecutionProfile` remains the semantic mapping layer

## Follow-Up Work

These are intentionally deferred:

- expose command execution tools inside `AUTOPILOT`
- make verify-gate mutation detection reflect real side effects beyond `WRITE` intent
- add repo-config `flowMode` defaults
- unify chat/run/serve/ACP mode control under a broader shared control plane
