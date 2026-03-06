# A2A Client SDK (Deprecated)

> **Note**: The A2A client SDK located at `src/core/protocols/a2a/client/` has been deprecated and removed as part of the A2A migration to the official `@a2a-js/sdk`.

## Migration Status

As of the A2A migration cleanup, the custom A2A client implementation has been removed. The server-side implementation now uses the official `@a2a-js/sdk` Express server adapter.

### What Changed

- **Removed**: `src/core/protocols/a2a/client/` directory and all related client code
- **Removed**: `createA2AHttpClient()` and associated types
- **Removed**: Custom HTTP transport and SSE subscription logic

### Current Architecture

The current implementation focuses on the **server-side** A2A protocol using `@a2a-js/sdk`:

- **Server**: Express-based SDK server (`src/core/protocols/a2a/sdk/server.ts`)
- **Executor**: Custom executor adapter (`src/core/protocols/a2a/sdk/executor.ts`)
- **Runtime**: Migrated runtime (`src/core/runtime/agent-server-runtime.ts`)

### How to Interact with Salmon-Loop Server

To interact with a Salmon-Loop A2A server, use any standard HTTP client or the official `@a2a-js/sdk` client:

```ts
import { JsonRpcTransport } from '@a2a-js/sdk/client';

const transport = new JsonRpcTransport({
  endpoint: 'http://localhost:7447/a2a/jsonrpc',
});

// Send a task request
const response = await transport.sendMessage({
  jsonrpc: '2.0',
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      parts: [{ kind: 'text', text: 'fix bug' }],
    },
  },
  id: 1,
});
```

### Alternative: Using Fetch API

For simple use cases, you can use the native Fetch API:

```ts
const response = await fetch('http://localhost:7447/a2a/jsonrpc', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer your-token',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'fix bug' }],
      },
    },
    id: 1,
  }),
});

const result = await response.json();
console.log(result);
```

### Server Capabilities

The Salmon-Loop A2A server supports:

- **Agent Card**: `/.well-known/agent-card.json`
- **JSON-RPC Endpoint**: `/a2a/jsonrpc`
- **Methods**:
  - `message/send` - Send a message and receive a completed task
  - `message/stream` - Stream task updates via SSE
  - `tasks/get` - Retrieve a task by ID
  - `tasks/cancel` - Cancel a running task

### Migration Checklist

If you were using the old A2A client SDK:

- [ ] Replace `createA2AHttpClient()` with `JsonRpcTransport` or Fetch API
- [ ] Update import paths from `src/core/protocols/a2a/client/` to `@a2a-js/sdk/client`
- [ ] Verify authentication headers are still applied correctly
- [ ] Test task submission and streaming functionality
- [ ] Update error handling to match JSON-RPC response format

### References

- [Official @a2a-js/sdk Documentation](https://github.com/ai16z/a2a-js)
- [A2A Protocol Specification](https://github.com/AI-2-All/a2a-spec)
- Salmon-Loop A2A Server Implementation: `src/core/protocols/a2a/sdk/`
