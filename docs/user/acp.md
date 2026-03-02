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

Send a prompt:

```json
{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"<session-id>","prompt":[{"type":"text","text":"Fix tests"}]}}
```

ACP streams progress via `session/update` notifications on stdout.

## Troubleshooting

- **No startup message**: ACP logs are on **stderr**. Stdout only outputs JSON-RPC.
- **No JSON-RPC response**: ensure ACP is enabled (no `--no-acp-stdio`).
- **UI can’t connect**: confirm the UI launches `s8p serve` as a stdio subprocess.

## Related

- `docs/user/cli.md` (serve command)
- `src/core/protocols/acp/README.md` (developer notes)
