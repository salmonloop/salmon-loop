diff --git a/src/core/tools/mcp/README.md b/src/core/tools/mcp/README.md
new file mode 100644
index 0000000000..1111111111
--- /dev/null
+++ b/src/core/tools/mcp/README.md
@@ -0,0 +1,64 @@
+# MCP tool integration
+
+This directory implements the Model Context Protocol (MCP) client for SalmonLoop, enabling tool execution via external MCP servers.
+
+## Protocol version
+
+- **MCP protocol**: `2025-11-25`
+
+## JSON-RPC operations
+
+The client implements the following MCP JSON-RPC methods:
+
+- `initialize`: Handshake with server, negotiating protocol version and capabilities.
+- `notifications/initialized`: Signal that client has completed initialization.
+- `tools/list`: Query the server for available tools and their schemas.
+- `tools/call`: Execute a specific tool with provided arguments.
+
+## Transport implementations
+
+### Stdio transport
+
+- Spawns a child process using `spawn()` with configurable `command`, `args`, `env`, and `cwd`.
+- Reads newline-delimited JSON-RPC messages from stdout, writes to stdin.
+- Handles process errors, exit codes, and stderr draining.
+
+### Streamable HTTP transport
+
+- Uses `fetch()` for POST requests (requests) and notifications.
+  - Headers include `MCP-Protocol-Version`, `Content-Type: application/json`, and optional `MCP-Session-Id`.
+- Supports server-sent events (SSE) for streaming responses.
+  - Decodes SSE events yielding JSON-RPC messages.
+  - Implements automatic reconnection via GET with `Last-Event-ID` header.
+  - Supports SSE `retry` directive for backoff timing.
+- Session management: Tracks session ID from response headers for stateful connections.
+- Cleanup: Sends DELETE request to close HTTP sessions on `stop()`.
+
+## Current capabilities
+
+- **Tools only**: The MCP client currently supports `tools/list` and `tools/call`. Resources, prompts, and other MCP capabilities are not yet implemented.
+- **Tool registration**: Each discovered tool is registered as:
+  - Name: `mcp.<server>.<tool>`
+  - Source: `mcp`
+  - Intent: `INFRA`
+  - Risk level: `medium`
+  - Side effects: `process`, `network`
+  - Allowed phases: `VERIFY` only
+  - Concurrency: `serial_only`
+  - Default timeout: `LIMITS.defaultToolTimeoutMs`
+
+## Governance and restrictions
+
+- **Allow-list enforcement**: `allow.tools` is mandatory; tools not on the list are silently skipped.
+- **Phase restriction**: MCP tools can only run during `Phase.VERIFY` to prevent modification of plans.
+- **Side effect tracking**: All MCP tools declare `['process', 'network']` side effects to trigger policy guard checks.
+- **Namespace isolation**: Tool names are prefixed with `mcp.<server>.` to prevent conflicts and enable audit logging.
+- **Error handling**: Failures during server start, tool listing, or individual tool calls are logged but do not prevent other servers from loading.
+- **Secret redaction**: Environment variables in MCP configuration are redacted when printing resolved extensions via CLI.
