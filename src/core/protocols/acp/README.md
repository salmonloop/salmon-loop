# ACP Adapter (agent-client-protocol)

This module implements the ACP (agent-client-protocol) stdio JSON-RPC adapter for Salmon-Loop.

## Scope

- Stdio JSON-RPC 2.0 transport (stdout only for protocol messages).
- ACP baseline methods:
  - `initialize`
  - `session/new`
  - `session/load`
  - `session/prompt`
  - `session/cancel`
  - `session/update` (notification)
- Draft methods (optional capabilities):
  - `session/list`
  - `session/delete`

## File Responsibilities

- `jsonrpc.ts`: request validation, method dispatch, session lifecycle, update notifications.
- `handlers.ts`: in-memory session store and helpers.
- `jsonrpc-error.ts`: ACP JSON-RPC error types.
- `src/core/transports/stdio/acp-stdio-loop.ts`: stdio read/write loop.

## Method Mapping

- `initialize` → protocol metadata and capability exposure.
- `session/new` → create session record (no task yet).
- `session/load` → reload session + replay history via `session/update`.
- `session/prompt` → create task via canonical facade and push `session/update` chunks.
- `session/cancel` → cancel current task (notification-only response).
- `session/list/delete` → local session store operations.

## Notifications

- `session/update` is the standard progress channel.
- All updates are emitted as JSON-RPC notifications to stdout.

## stdout/stderr Constraints

- **stdout**: ACP JSON-RPC only.
- **stderr**: logs and startup messages (safe for UI).

## Testing

- Unit tests: `tests/unit/acp/*.test.ts`
- Integration tests: `tests/integration/acp/stdio-stream.test.ts`

Run:

```bash
bun test tests/unit/acp/initialize.test.ts
bun test tests/integration/acp/stdio-stream.test.ts
```
