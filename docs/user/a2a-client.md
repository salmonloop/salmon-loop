# A2A Client SDK

This document covers the A2A client SDK usage for Salmon-Loop. The client is protocol-focused, with a pluggable transport and a canonical task model.

## Quick Start

```ts
import { createA2AHttpClient } from '../src/core/protocols/a2a/client/index.js';

const client = createA2AHttpClient({
  baseUrl: 'https://example.com',
  defaultOptions: {
    headers: { authorization: 'Bearer token' },
    reconnect: { maxRetries: 3, baseDelayMs: 250, maxDelayMs: 2000 },
    idleTimeoutMs: 60_000,
  },
});

const task = await client.startTask({ instruction: 'fix bug' });
console.log(task.id, task.state);
```

## Default Options and Per-Call Overrides

`createA2AHttpClient` accepts `defaultOptions`, which are applied across calls. Each API call can override headers and subscription settings.

```ts
const client = createA2AHttpClient({
  baseUrl: 'https://example.com',
  defaultOptions: {
    headers: { authorization: 'Bearer default' },
    reconnect: { maxRetries: 2 },
    idleTimeoutMs: 30_000,
  },
});

await client.startTask(
  { instruction: 'fix bug' },
  { headers: { authorization: 'Bearer override' } },
);
```

## Subscribing to Task Updates

Use `subscribeTask` to stream updates over SSE. The client will automatically apply stream events to the canonical task model.

```ts
await client.subscribeTask('task_1', (task) => {
  console.log('stream update', task.state);
});
```

### Idle Timeout

Set `idleTimeoutMs` to auto-close a subscription when no events arrive for the specified duration.

```ts
await client.subscribeTask('task_1', (task) => {
  console.log('stream update', task.state);
}, {
  idleTimeoutMs: 10_000,
});
```

### Auto Sync on Stream End

By default, when the stream ends the client performs a `syncTask` call to fetch the latest snapshot. You can disable this behavior with `autoSyncOnEnd`.

```ts
await client.subscribeTask('task_1', (task) => {
  console.log('stream update', task.state);
}, {
  autoSyncOnEnd: false,
});
```

### onSync Callback

If you want to separate stream updates from snapshot reconciliation, provide an `onSync` callback.

```ts
await client.subscribeTask('task_1', (task) => {
  console.log('stream update', task.state);
}, {
  onSync: (snapshot) => {
    console.log('sync snapshot', snapshot.state);
  },
});
```

## Sync with Replay Requirements

`syncTask` supports replay requests for server-side event replay. Use `sinceEventId` to request a replay starting after that event. If you need strict replay behavior, set `requireReplay`.

```ts
await client.syncTask('task_1', {
  sinceEventId: '42',
  requireReplay: true,
});
```

If `requireReplay` is true and the server does not support replay, the request fails with a JSON-RPC error.

When replay events are returned by the server, the client applies them to the canonical task state before returning the result.

## API Summary

- `startTask(input, options?)`
- `syncTask(taskId, options?)`
- `subscribeTask(taskId, handler, options?)`

Key options:
- `headers`
- `reconnect` (`maxRetries`, `baseDelayMs`, `maxDelayMs`)
- `idleTimeoutMs`
- `autoSyncOnEnd`
- `onSync`
