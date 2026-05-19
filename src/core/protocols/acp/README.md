# ACP Adapter (agent-client-protocol)

This module implements the ACP (agent-client-protocol) stdio JSON-RPC adapter for Salmon-Loop.

## Scope

- Stdio JSON-RPC 2.0 transport (stdout only for protocol messages).
- ACP baseline methods via official SDK:
  - `initialize`
  - `authenticate`
  - `session/new`
  - `session/load`
  - `session/list`
  - `session/delete`
  - `session/resume`
  - `session/close`
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
- `session/new` → create transient in-memory session record (no task yet).
- `session/load` → reload session + replay history via `session/update`.
- `session/list` → list known in-memory and persisted sessions, optionally filtered by absolute `cwd`, with cursor-based pagination.
- `session/delete` → remove a listed/history session and cancel its active task if one exists.
- `session/resume` → restore active session state without replaying previous messages.
- `session/close` → cancel active work and release active-session runtime state. Unused transient sessions are discarded; materialized sessions remain list/load/resume-able.
- `session/set_config_option` → update session config selectors and return latest config options.
- `session/prompt` → create task via canonical facade and push `session/update` chunks.
- `session/cancel` → cancel current task (notification-only response).

## Advertised Capabilities

The adapter advertises only capabilities backed by runtime behavior:

- `loadSession: true` by default, configurable off for compatibility tests.
- `sessionCapabilities.list`, `sessionCapabilities.delete`, `sessionCapabilities.resume`, and `sessionCapabilities.close`.
- `mcpCapabilities.http: true`; ACP MCP `stdio` is baseline protocol support.
- `mcpCapabilities.sse: false` and `mcpCapabilities.acp: false`.
- `promptCapabilities.image`, `audio`, and `embeddedContext` are false by default.

Current non-goals:

- `session/fork`, provider configuration, NES, and ACP `set_model` are not advertised.
- Non-empty `additionalDirectories` is rejected with `-32602` until Salmon-Loop has multi-root workspace semantics wired end to end.
- MCP-over-SSE and MCP-over-ACP transports are rejected with `-32602` instead of being silently ignored.

ACP `mcpServers` from `session/new`, `session/load`, or `session/resume` are translated into
Salmon-Loop resolved extensions for that session. Session MCP servers are merged with repo/user
extensions resolved at server startup, so ACP-provided tools do not disable configured tools,
plugins, or skill discovery.

## SalmonLoop Checkpoint Meta

When available, `session/new` and `session/load` responses include:

- `_meta.salmonloop.latestCheckpointId`
- `_meta.salmonloop.checkpoint = { id, createdAt, strategy, backend }`
- `_meta.salmonloop.resumeReady`
- `_meta.salmonloop.resumeProbe = { checkpointId, valid, reason }`
- `_meta.salmonloop.resumeHint`
- `_meta.salmonloop.resumeHintCode`

UI should prefer rendering from `_meta.salmonloop.checkpoint` (typed object) rather than
only reading `latestCheckpointId`.

`resumeProbe.reason` is a soft failure classifier:

- `ok`
- `not_found`
- `manifest_unavailable`
- `manifest_parse_error`
- `manifest_io_error`
- `manifest_lock_timeout`

`resumeHint` / `resumeHintCode` provide UI-safe human-readable fallback messaging for
resume failures, so UI can avoid generic hidden-technical-details prompts.

Recommended UI mapping priority:

1. Use `resumeHintCode` for i18n key lookup.
2. Fallback to server-provided `resumeHint`.
3. Fallback to generic "resume unavailable".

Current stable `resumeHintCode` values:

- `CHECKPOINT_NOT_FOUND`
- `CHECKPOINT_MANIFEST_PARSE_ERROR`
- `CHECKPOINT_MANIFEST_IO_ERROR`
- `CHECKPOINT_MANIFEST_LOCK_TIMEOUT`
- `CHECKPOINT_MANIFEST_UNAVAILABLE`
- `CHECKPOINT_RESUME_UNAVAILABLE`

Compatibility guarantee:

- These listed codes are stable for ACP `protocolVersion: 1`.
- New codes may be added additively; clients should ignore unknown codes and fallback to generic messaging.
- Existing code semantics will not be repurposed without explicit protocol compatibility notice.

## Session Persistence

- ACP session identity is persisted in user runtime storage after a real conversation turn starts and can be reloaded after process restart.
- Default persistence file: `~/.salmonloop/runtime/acp/sessions.v1.json`.
- A freshly-created `session/new` with no `session/prompt` history is transient. If closed before any conversation, it is discarded and never appears after restart.
- Persisted fields include safe session state:
  `sessionId`, `cwd`, `mcpServers`, timestamps, title, recent `history`, `taskId`,
  permission policy, and mode.
- Deleted sessions are persisted as tombstones until normal retention expiry so they do not reappear
  after a process restart or concurrent persistence merge.
- Store is bounded by retention policy (30 days, max 200 sessions, capped history per session).
- Persistence schema supports migration (`schemaVersion` v1 -> v2 normalization during load).

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
