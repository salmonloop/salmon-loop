# Headless Protocol Encoders (CLI)

This folder contains CLI-only protocol encoders for *headless* output modes.

Core is protocol-neutral and emits internal `LoopEvent`s (including canonical responses events).
CLI adapters map those events to stable on-stdout protocols:

- SalmonLoop native JSONL (`--output-profile native`)
- Anthropic / Claude Code-compatible JSONL (`--output-profile anthropic`)
- OpenAI Responses streaming events (`--output-profile openai`)

## Architecture

### Inputs

Headless reporters consume the internal event bus:

- Canonical events: `type: "llm.responses.event"` (preferred)
- Normalized events: `NormalizedStreamEvent` produced by `StreamAssembler`

### Encoders

- Native: `src/cli/headless/native-stream-normalized-encoder.ts`
- Anthropic: `src/cli/headless/anthropic-stream-normalized-encoder.ts`
- OpenAI: `src/cli/headless/openai-stream-encoder.ts`
  - Design: "sequencer + passthrough" for canonical events.

### Protocol wrappers / writers

- `src/cli/headless/stream-json-protocol.ts`
- `src/cli/headless/anthropic-stream-protocol.ts`
- `src/cli/headless/json-protocol.ts`
- `src/cli/headless/stdout-writer.ts`

## Golden fixtures

Protocol stability is enforced via golden fixtures in:

- `tests/fixtures/headless/native/*`
- `tests/fixtures/headless/anthropic/*`
- `tests/fixtures/headless/openai/*`

Reporters and encoders are covered by:

- `tests/unit/cli/reporters/stream-json.test.ts`
- `tests/unit/cli/reporters/anthropic-stream.test.ts`
- `tests/unit/cli/reporters/openai-stream.test.ts`
- `tests/integration/headless-protocol.test.ts`

## Redaction policy

By default, tool arguments and tool outputs are not emitted in headless protocols unless the user
opts in via payload flags (see `docs/user/cli.md`).

