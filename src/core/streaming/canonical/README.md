# Canonical Responses Streaming (Core)

This module provides a provider-agnostic *canonical* intermediate representation (IR) for streaming
LLM output, inspired by the OpenAI Responses streaming taxonomy.

The goal is to keep **core** protocol-neutral while still enabling:

- Stable event synthesis (for UI and headless adapters)
- Deterministic mapping into `NormalizedStreamEvent` via `StreamAssembler`
- Strict-by-default redaction for tool arguments

## Key types

- `CanonicalStreamPart` (input): a small, provider-neutral "stream part" produced from provider
  chunks or synthesized by the runtime.
  - Source: `src/core/streaming/canonical/canonical-responses-event-emitter.ts`
- `CanonicalResponsesEvent` (output): OpenAI-like event objects that are emitted on the internal
  `LoopEvent` bus as `type: "llm.responses.event"`.
  - Source: `src/core/streaming/canonical/responses-events.ts`

## State machines

### `CanonicalResponsesEventEmitter`

File: `src/core/streaming/canonical/canonical-responses-event-emitter.ts`

Consumes `CanonicalStreamPart` and emits `CanonicalResponsesEvent[]`.

Design constraints:

- **Provider-agnostic input**: the emitter does not depend on any specific SDK types.
- **Safe defaults**: tool arguments are redacted by default (`"{}"`).
- **Forward compatible**: do not require every OpenAI field to be present; adapters may fill
  optional fields if needed.

## Mapping from provider stream chunks

File: `src/core/streaming/canonical/parts-from-llm-stream-chunk.ts`

`mapLlmStreamChunkToCanonicalStreamParts({ streamId, chunk })` converts `LLMStreamChunk` into
canonical parts (text deltas, tool call starts, argument deltas, etc.).

The runtime may also synthesize parts (for example, closing function call lifecycles) when a
provider only returns `tool_calls` at the end of a streamed assistant turn.

## Downstream: `StreamAssembler`

`StreamAssembler` consumes `llm.responses.event` and produces `NormalizedStreamEvent[]`.

- Source: `src/core/streaming/stream-assembler.ts`
- Invariants: canonical events are consumed first; legacy `llm.stream.*` events are ignored when a
  canonical equivalent exists (deduplication).

## Tests

- `tests/unit/core/streaming/canonical/canonical-responses-event-emitter.test.ts`
- `tests/unit/core/streaming/canonical/parts-from-llm-stream-chunk.test.ts`
- `tests/unit/core/streaming/stream-assembler.test.ts`

