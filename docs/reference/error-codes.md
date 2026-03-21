# Error Codes

This document defines stable error codes that SalmonLoop may surface in CLI output and audit logs.
These codes are designed to be used in troubleshooting, automation, and regression tests.

Where to find error codes:

- CLI: printed on failure (when available)
- Audit log: `.salmonloop/runtime/audit/audit-*.json` under `meta.errorCode` and `traces[].metadata`

## LLM

### `LLM_HTTP_RESPONSE_INVALID_JSON`

Meaning: the LLM client failed to parse the provider response as JSON (commonly a truncated response or a malformed proxy).

Actions:

- Check `llm.providers.<key>.api.baseUrl` and any proxy in front of it.
- Check `llm.providers.<key>.api.timeoutMs` and increase it if your provider is slow.
- Inspect the audit log for `errorName`/`errorStack` and `context.toolCallingAudit` (if present).

### `LLM_HTTP_ABORTED`

Meaning: the LLM request was aborted (most commonly due to timeout).

Actions:

- Increase `llm.providers.<key>.api.timeoutMs`.
- Check network stability and provider latency.

### `LLM_HTTP_REQUEST_FAILED`

Meaning: the LLM request failed for a non-JSON-parse reason (network error, upstream error, etc.).

Actions:

- Verify API key and base URL.
- Inspect `meta.error` / `meta.errorStack` in the audit log.

### `LLM_AUTHENTICATION_FAILED`

Meaning: the LLM provider rejected the request credentials or model access.

Actions:

- Verify the configured API key, app id, and provider base URL.
- Confirm the selected model is enabled for the current account or project.
- Inspect the audit log for provider-specific auth details.

### `LLM_PATCH_EMPTY`

Meaning: the PATCH phase produced empty output.

Actions:

- Re-run with `--verbose=extended`.
- Inspect the audit log and confirm the model output was non-empty.

### `LLM_PATCH_NOT_UNIFIED_DIFF`

Meaning: the PATCH phase returned content that is not a valid git unified diff.

Actions:

- Ensure the model is instructed to output only a unified diff.
- Check the audit log for the patch output and the validation failure trace.

### `LLM_PATCH_INVALID`

Meaning: the PATCH phase produced output that fails validation (beyond the specific cases above).

Actions:

- Inspect the audit log for the validation error message.
- Reduce the scope of the instruction or the number of changed files.

## Diff / Validation

### `DIFF_VALIDATION_FAILED`

Meaning: the generated diff failed SalmonLoop validation rules (format, file count, line count, path safety).

Actions:

- Ensure the patch is a valid unified diff.
- Confirm the diff does not include unsafe paths.

## Git

### `GIT_ERROR`

Meaning: a git command failed.

Actions:

- Inspect the audit log for command stderr and the pipeline phase that failed.
- Ensure your repository is a valid git repo and has a sane configuration.

## Tool Calling (Audit)

These are typically recorded under `context.toolCallingAudit[*].toolResultErrorCode`.

### `INVALID_TOOL_ARGUMENTS_JSON`

Meaning: the model produced a tool call where `tool_calls[].function.arguments` was not valid JSON.

Actions:

- Inspect `context.toolCallingAudit` entries to see which tool was called and why parsing failed.
- Consider reducing tool calling rounds or tightening prompts (maintainers).
