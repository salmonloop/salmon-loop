# Agent Client Protocol (ACP) Stdio Integration Design

Date: 2026-03-01
Status: Draft

## Summary

Add an Agent Client Protocol (ACP, agent-client-protocol) stdio adapter alongside the existing A2A HTTP server and the local sidecar UDS server. ACP will follow the published JSON-RPC 2.0 schema and stdio transport rules. Sidecar remains intact for future internal use. ACP draft methods `session/list` and `session/delete` will be implemented and exposed as optional capabilities.

## Goals

- Provide a standards-compliant ACP stdio server for ACP UI clients.
- Preserve the existing A2A HTTP server and sidecar UDS server.
- Keep protocol logic isolated from the execution core and orchestration.
- Support high-frequency progress updates via `session/update` notifications.
- Implement ACP draft methods as optional capabilities with forward-compatibility.

## Non-Goals

- Replacing the A2A adapter or sidecar.
- Implementing ACP Streamable HTTP transport (draft).
- Adding non-standard ACP methods or extensions beyond required scope.

## Architecture

### Layering

- Execution core and orchestration remain unchanged.
- New protocol adapter: `src/core/protocols/acp/*`.
- New transport adapter: stdio JSON-RPC loop under `src/core/transports/stdio/*` or equivalent.
- Server runtime creates three entry points in parallel.

### Entry Points

- A2A HTTP server (existing).
- Sidecar UDS server (existing).
- ACP stdio server (new).

## Protocol Scope

### Baseline Methods

- `initialize`
- `session/new`
- `session/load`
- `session/prompt`
- `session/cancel`
- `session/update` (notification)

### Draft Methods (Optional Capabilities)

- `session/list`
- `session/delete`

### Transport Constraints

- Stdio only.
- `stdout` is ACP JSON-RPC only.
- `stderr` may contain logs.
- Messages are single-line JSON with `\n` line delimiters.

## Mapping to Canonical Model

- `initialize` maps to capability exposure and server metadata.
- `session/new` creates a canonical task/session envelope.
- `session/prompt` triggers task execution with the selected mode.
- `session/update` mirrors canonical TaskEvent/Artifact updates.
- `session/load` replays historical updates.
- `session/list/delete` operate on a minimal local session store.

## Configuration and UX

- `salmon-loop serve` gains an ACP stdio flag or configuration toggle.
- ACP UI uses `agents.json` to run `salmon-loop serve` with stdio enabled.
- Existing `server.sidecar.socket` configuration remains unchanged.

## Error Handling

- JSON-RPC 2.0 error objects (`code`, `message`, `data`) are required.
- Unsupported features are omitted from `initialize.capabilities`.
- Draft method compatibility is guarded by capabilities and version checks.

## Testing

- New integration tests that open stdio, send JSON-RPC, and assert:
- `initialize` handshake.
- `session/new` creation and `session/prompt` execution.
- `session/update` streaming.
- `session/list/delete` behavior.
- Existing A2A and sidecar tests remain unchanged.

## Engineering Level

- Just right. The adapter isolates ACP concerns while preserving existing protocols and minimizing cross-module coupling. Draft methods are explicitly optional to avoid over-commitment to unstable spec areas.

