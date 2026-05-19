# Agent Client Protocol (ACP)

ACP (agent-client-protocol) is a local stdio JSON-RPC protocol used by ACP-compatible UIs to drive Salmon-Loop.

## Quick Start

Start the server:

```bash
s8p serve
```

For ACP UIs that only need stdio (and to avoid HTTP port conflicts), start ACP-only mode:

```bash
s8p serve acp
```

Or in dev:

```bash
bun run dev serve
```

ACP runs over stdio, so **stdout is reserved for JSON-RPC only**. Startup logs are printed to **stderr**.

Execution model:
- ACP is used as the control/authorization plane by default.
- Side-effect execution (including git checkpoint preflight) runs in Salmon-Loop local runtime unless client binding is explicitly enabled.

Disable ACP stdio (if needed):

```bash
s8p serve --no-acp-stdio
```

## UI Integration (agents.json)

Configure your ACP UI to launch Salmon-Loop as a stdio agent:

```json
{
  "name": "salmon-loop",
  "command": "s8p",
  "args": ["serve", "acp"],
  "env": {
    "NODE_ENV": "production"
  }
}
```

## Minimal JSON-RPC Examples

Initialize:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"manual","version":"0.0.0"},"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}
```

Create a session:

```json
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/path/to/repo","mcpServers":[]}}
```

List sessions for a repo:

```json
{"jsonrpc":"2.0","id":3,"method":"session/list","params":{"cwd":"/path/to/repo"}}
```

If the response includes `nextCursor`, pass it back as `params.cursor` to fetch the next page:

```json
{"jsonrpc":"2.0","id":4,"method":"session/list","params":{"cwd":"/path/to/repo","cursor":"<opaque-cursor>"}}
```

Resume a session without replaying previous messages:

```json
{"jsonrpc":"2.0","id":5,"method":"session/resume","params":{"sessionId":"<session-id>","cwd":"/path/to/repo"}}
```

Send a prompt:

```json
{"jsonrpc":"2.0","id":6,"method":"session/prompt","params":{"sessionId":"<session-id>","prompt":[{"type":"text","text":"Fix tests"}]}}
```

ACP streams progress via `session/update` notifications on stdout.

Update a session config option:

```json
{"jsonrpc":"2.0","id":7,"method":"session/set_config_option","params":{"sessionId":"<session-id>","configId":"_salmonloop_permission_policy","value":"deny_all"}}
```

Current built-in config option:

- `_salmonloop_permission_policy`
  - `ask` (default): request UI permission for side-effecting tools
  - `deny_all`: auto-deny side-effecting tools
  - `allow_all`: auto-allow side-effecting tools for explicitly trusted local runs

Close a session:

```json
{"jsonrpc":"2.0","id":8,"method":"session/close","params":{"sessionId":"<session-id>"}}
```

Delete a listed session:

```json
{"jsonrpc":"2.0","id":9,"method":"session/delete","params":{"sessionId":"<session-id>"}}
```

## Supported Capabilities

Salmon-Loop currently advertises:

- `loadSession: true`
- `sessionCapabilities.list`, `sessionCapabilities.delete`, `sessionCapabilities.resume`, and `sessionCapabilities.close`
- MCP stdio session servers, plus `mcpCapabilities.http: true`
- `mcpCapabilities.sse: false` and `mcpCapabilities.acp: false`
- prompt image/audio/embedded-context support as disabled by default

ACP `mcpServers` passed on session setup are added to the task's runtime tools. They are merged
with configured repo/user extensions, so configured MCP servers, tool plugins, and skill discovery
remain available.

## Compatibility Contract

Salmon-Loop exposes ACP extension metadata under `_meta.salmonloop.*`.

Versioning policy:

- This metadata follows an additive compatibility contract for ACP `protocolVersion: 1`.
- Existing fields/codes are never silently repurposed.
- New fields/codes may be added; clients must ignore unknown values.

`resumeHintCode` compatibility:

- **Stable codes** (backward-compatible; safe for UI i18n key mapping):
  - `CHECKPOINT_NOT_FOUND`
  - `CHECKPOINT_MANIFEST_PARSE_ERROR`
  - `CHECKPOINT_MANIFEST_IO_ERROR`
  - `CHECKPOINT_MANIFEST_LOCK_TIMEOUT`
  - `CHECKPOINT_MANIFEST_UNAVAILABLE`
  - `CHECKPOINT_RESUME_UNAVAILABLE`
- **Extensible space**:
  - Future codes may be added without ACP protocol major bump.
  - UI must treat unknown codes as generic resume-unavailable and optionally render `resumeHint`.

## Troubleshooting

- **No startup message**: ACP logs are on **stderr**. Stdout only outputs JSON-RPC.
- **No JSON-RPC response**: ensure ACP is enabled (no `--no-acp-stdio`).
- **UI can’t connect**: confirm the UI launches `s8p serve` as a stdio subprocess.
- **`failed to get old checkpoint ... not implemented yet` in UI logs**:
  - This is currently a UI-side warning in some ACP clients, not a Salmon-Loop protocol failure.
  - Check Salmon-Loop audit logs for the real failure reason.
- **`PREFLIGHT_SNAPSHOT_FAILED` with `step=write-tree`**:
  - Verify the ACP session `cwd` points to a real Git worktree.
  - Salmon-Loop now executes per-session tasks against `session.cwd` (fallback: server startup repo path), so incorrect UI `cwd` is the most common cause.

## Related

- `docs/user/cli.md` (serve command)
- `src/core/protocols/acp/README.md` (developer notes)
