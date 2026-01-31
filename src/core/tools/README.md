# Tools (Internal)

This directory contains the tool-calling subsystem:
- Tool specifications (ToolSpec)
- Policy gating (what tools are allowed in which phase)
- Budget/concurrency guards
- Audit logging
- Provider mapping (e.g., OpenAI tools format)

## Why This Exists

Tool execution is a high-risk side-effect surface. SalmonLoop routes all tool calls through a single gate
to enforce security constraints and auditing.

See `docs/design/tool-governance.md` for the public contract.

## Streaming & Shared Helpers

- `chatWithToolsStreaming.ts` (used by `grizzco/steps/plan.ts`) now consumes `LLM.chatStream`, aggregates `contentDelta` chunks into a single assistant message, collects native `tool_calls`, and then delegates to the shared executor below. This keeps PLAN read-only while surfacing streaming events.
- `chatWithTools` and the streaming version share `executeToolCalls`, which encapsulates audit logging, policy decisions, JSON parsing, and tool result serialization. The helper ensures both code paths remain aligned even as new tool-calling edge cases are introduced.
- `ToolCallAccumulator` now exposes `append`/`drain`/`hasAccumulated` so consumers can safely accumulate `tool_calls` from any chunk-oriented stream (text deltas, tool-call events, etc.) before handing them to the shared executor.
