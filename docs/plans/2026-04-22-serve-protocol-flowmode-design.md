# Serve Protocol FlowMode Design

Date: 2026-04-22

## Context

`autopilot` is now a first-class internal `FlowMode` for `run` and `chat`, but the server-facing protocol surfaces still lag behind:

- `serve` exposes only a `patch` capability on the A2A side
- A2A request execution defaults to `patch`
- ACP currently uses `mode` to represent local permission semantics (`interactive | yolo`) instead of execution semantics
- ACP task creation still hardcodes internal execution to `patch`

This leaves `serve`, ACP, and A2A outside the unified flow-mode architecture even though the execution kernel already supports `autopilot`.

## Goals

- Make `serve` default execution semantics align with internal `autopilot`
- Keep ACP and A2A strictly within their official protocol models
- Map protocol-standard selectors into internal `FlowMode`
- Keep `permissionMode` fully separate from protocol-level flow selection
- Avoid protocol-breaking custom fields and avoid speculative protocol design

## Non-Goals

- Adding custom ACP or A2A protocol fields
- Reworking repo config schema to add `flowMode` defaults
- Reworking chat or run entrypoints in this slice
- Redesigning authorization policy semantics
- Adding new execution modes beyond existing internal `FlowMode`

## Protocol Principles

### ACP

ACP already has a standard concept of session modes. In this slice:

- ACP `modeId` maps to internal `FlowMode`
- ACP session mode selection controls execution semantics only
- ACP session mode must no longer be used as a proxy for permission semantics
- ACP permission behavior remains server-local and is handled by authorization policy/provider wiring

### A2A

A2A does not define a generic `mode` field for execution semantics. In this slice:

- A2A `skills` represent externally advertised execution entrypoints
- selected skill maps to internal `FlowMode`
- protocol `capabilities` continue to represent protocol/runtime features, not execution modes

## Recommended Approach

### 1. Introduce one shared protocol-to-flow mapping layer

Add a small shared adapter module under `src/core/protocols/shared/` responsible for:

- parsing ACP session mode ids into `FlowMode`
- building A2A skill declarations from supported flow modes
- resolving A2A-selected skill ids into `FlowMode`

This keeps protocol-specific translation out of `runSalmonLoop()` and out of CLI command code.

### 2. Make ACP session mode represent execution mode

ACP `modeId` should be changed from:

- `interactive`
- `yolo`

to the supported execution modes:

- `autopilot`
- `patch`
- `review`
- `debug`
- `research`
- `answer`

The ACP agent should:

- default new sessions to `autopilot`
- persist session mode as `FlowMode`
- use the current ACP session mode when creating internal execution requests

`permissionMode` remains server-owned and should not be serialized as ACP session mode.

### 3. Make A2A skills represent flow entrypoints

The A2A agent card should stop advertising only `patch`.

Instead, it should advertise one skill per supported flow mode, with the default recommendation centered on `autopilot`.

The A2A executor should:

- resolve the selected skill into internal `FlowMode`
- default to `autopilot` when the incoming request does not explicitly identify a supported flow skill

This preserves standards compliance because skills are the standard A2A surface for "what the agent can do."

### 4. Keep `serve` defaults orthogonal

`serve` currently mixes three different concepts:

- protocol-facing execution selection
- server-local permission defaults
- execution kernel defaults

This slice should separate them cleanly:

- default protocol flow selection: `autopilot`
- internal execution mode fallback: `autopilot`
- server-local permission mode: unchanged, still derived from config

## Data Flow

### ACP path

`ACP modeId -> protocol flow mapper -> internal FlowMode -> runSalmonLoop(mode) -> ExecutionProfile`

### A2A path

`A2A skill id -> protocol flow mapper -> internal FlowMode -> runSalmonLoop(mode) -> ExecutionProfile`

### Authorization path

`resolvedConfig.permissionMode -> authorization provider / policy`

Authorization must not be inferred from ACP mode or A2A skill.

## Compatibility Strategy

### ACP legacy sessions

Old ACP sessions may still contain:

- `interactive`
- `yolo`

These should not remain valid execution modes.

Instead:

- on load, legacy ACP session mode values degrade safely to `autopilot`
- server emits a warning/update so the client can understand the migration
- no dual-semantic compatibility layer is kept long-term

This avoids continuing the architectural bug where one field secretly means both flow and permission.

### A2A

No legacy mode migration is needed because A2A does not currently persist protocol session mode in the same way.

## Risks

- ACP clients that assumed `mode=interactive|yolo` will see a semantic change
- If `serve` wiring remains partially permission-driven, mode separation will regress silently
- If A2A skill selection is mapped loosely, clients may see ambiguous behavior between `autopilot` and `patch`

## Testing Strategy

### Unit tests

- ACP mode parsing maps valid flow mode ids to internal `FlowMode`
- ACP legacy values (`interactive`, `yolo`) degrade to `autopilot`
- A2A skill builder advertises the expected flow-backed skills
- A2A skill resolver maps supported skill ids to internal `FlowMode`

### Integration tests

- ACP default session mode is `autopilot`
- ACP `set_mode(debug)` leads to internal execution with `mode='debug'`
- ACP legacy persisted mode values recover safely to `autopilot`
- A2A agent card advertises flow-backed skills
- A2A request execution defaults to `autopilot`
- A2A explicit skill selection routes to the requested `FlowMode`

## Why This Slice Is Right

This is the smallest clean server-side slice that makes `autopilot` a real peer of existing modes across protocol surfaces without inventing protocol extensions.

It preserves the intended system boundary:

- protocol selectors choose execution flow
- `FlowMode` owns execution semantics
- `ExecutionProfile` owns internal runtime behavior
- `permissionMode` stays local to authorization

## Follow-Up Work

Intentionally deferred:

- repo-config `flowMode` defaults
- protocol-surface exposure of richer flow metadata beyond standard selectors
- broader control-plane unification across chat/run/serve
- protocol-aware UX improvements for clients that want better flow selection discoverability
