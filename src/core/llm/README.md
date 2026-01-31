# LLM Layer (Internal)

This folder holds the adapters and runtime factories for the LLM providers used by SalmonLoop.

## Config Flow

- All environment overrides (`SALMONLOOP_API_KEY`, `SALMONLOOP_BASE_URL`, `SALMONLOOP_MODEL`, plus legacy aliases) flow through `core/config/resolve.ts`. Resolved config objects expose `api.baseUrl`, `api.apiKey`, and `models.selectedModelId`, which are then passed straight into `AiSdkLLM` via `core/llm/factory.ts`/`registry.ts`. This keeps the transport layer unaware of raw env parsing and concentrates compatibility logic in one place.
- Base URLs are normalized (trailing slashes trimmed) so users can copy provider URLs verbatim (`https://provider/v1/`) without needing to sanitize them manually.

## Error & Streaming Notes

- `toLlmError` now preserves the provider response payload (`statusCode`, `responseBody`, `data.error.message`) and surfaces it via `LlmError.meta`, giving the CLI/audit layers direct access to HTTP/TLS failure messages for faster diagnosis.
- When the provider exposes `chatStream`, `chatWithToolsStreaming` (via `core/tools/session.ts`) merges the streaming chunks into a single assistant turn before running the helper executor, so the ERROR/PLAN stage behavior stays deterministic while benefiting from streaming tool-call insight.
