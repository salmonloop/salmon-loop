# LLM Layer (Internal)

This folder holds the adapters and runtime factories for the LLM providers used by SalmonLoop.

## Config Flow

- All environment overrides (`SALMONLOOP_API_KEY`, `SALMONLOOP_BASE_URL`, `SALMONLOOP_MODEL`, plus legacy aliases) flow through `core/config/resolve.ts`. Resolved config objects expose `api.baseUrl`, `api.apiKey`, and `models.selectedModelId`, which are then passed straight into `AiSdkLLM` via `core/llm/factory.ts`/`registry.ts`. This keeps the transport layer unaware of raw env parsing and concentrates compatibility logic in one place.
- Base URLs are normalized (trailing slashes trimmed) so users can copy provider URLs verbatim (`https://provider/v1/`) without needing to sanitize them manually.

## Error, Retry & Streaming Notes

- `toLlmError` now preserves the provider response payload (`statusCode`, `responseBody`, `data.error.message`) and surfaces it via `LlmError.meta`.
- **Retry Mechanism**: Implemented in `retry-utils.ts` with exponential backoff. Both `chat` and `chatStream` now automatically retry on transient failures (timeouts, rate limits, server overloads).
- **Streaming**: `chatStream` now uses `fullStream` to explicitly handle `error`, `abort`, and `finishReason` events.
- `chatWithToolsStreaming` (via `core/llm/ai-sdk.ts`) allows the pipeline to surface text deltas and tool execution status in real-time.
- The CLI exposes `--llm-output` to control which model outputs are shown (`review`, `assistant_message`, `plan`, `patch`). Output is sanitized and truncated before reaching UI/CLI surfaces.
- `--stream-output` remains as a compatibility flag to enable plan-streaming output when supported by the provider.
