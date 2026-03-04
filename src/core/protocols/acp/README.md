# ACP Adapter (agent-client-protocol)

This module implements the ACP (agent-client-protocol) stdio JSON-RPC adapter for Salmon-Loop.

## Scope

- Stdio JSON-RPC 2.0 transport (stdout only for protocol messages).
- ACP baseline methods via official SDK:
  - `initialize`
  - `authenticate`
  - `session/new`
  - `session/load`
  - `session/set_config_option`
  - `session/prompt`
  - `session/cancel` (notification)
  - `session/update` (notification)
- Client capability methods (agent → client requests) via official SDK:
  - `session/request_permission`
  - `fs/read_text_file`
  - `fs/write_text_file`
  - `terminal/*`

## File Responsibilities

- `formal-agent.ts`: ACP Agent implementation (session lifecycle, prompt handling, session/update).
- `permission-provider.ts`: maps internal tool authorization to `session/request_permission`.
- `stdio-server.ts`: stdio transport bootstrap using `ndJsonStream`.
- `handlers.ts`: in-memory session store and helpers.

## Method Mapping

- `initialize` → protocol metadata and capability exposure.
- `session/new` → create session record (no task yet).
- `session/load` → reload session + replay history via `session/update`.
- `session/set_config_option` → update session config selectors and return latest config options.
- `session/prompt` → create task via canonical facade and push `session/update` chunks.
- `session/cancel` → cancel current task (notification-only response).

## SalmonLoop Checkpoint Meta

When available, `session/new` and `session/load` responses include:

- `_meta.salmonloop.latestCheckpointId`
- `_meta.salmonloop.checkpoint = { id, createdAt, strategy, backend }`
- `_meta.salmonloop.resumeReady`
- `_meta.salmonloop.resumeProbe = { checkpointId, valid, reason }`

UI should prefer rendering from `_meta.salmonloop.checkpoint` (typed object) rather than
only reading `latestCheckpointId`.

`resumeProbe.reason` is a soft failure classifier:

- `ok`
- `not_found`
- `manifest_unavailable`

## Session Persistence

- ACP session identity is persisted in user runtime storage and can be reloaded after process restart.
- Default persistence file: `~/.salmonloop/runtime/acp/sessions.v1.json`.
- Persisted fields are safe metadata only (`sessionId`, `cwd`, `mcpServers`, timestamps, title).

## Notifications

- `session/update` is the standard progress channel.
- This implementation emits:
  - `agent_message_chunk`
  - `tool_call`
  - `tool_call_update`
  - `plan`
  - `available_commands_update`
  - `config_option_update`
  - `session_info_update`
- All updates are emitted as JSON-RPC notifications to stdout.

## stdout/stderr Constraints

- **stdout**: ACP JSON-RPC only.
- **stderr**: logs and startup messages (safe for UI).

## Testing

- Unit tests: `tests/unit/acp/*.test.ts`

Run:

```bash
bun test tests/unit/acp/formal-protocol-sdk.test.ts
```
