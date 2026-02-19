# Troubleshooting

If a run fails, first check the latest audit log in `.salmonloop/runtime/audit/audit-*.json` and look for `meta.errorCode`.
Stable codes are documented in `docs/reference/error-codes.md`.

## Langfuse outcome reporting failed

Symptom:

- The CLI prints: `[Langfuse] Failed to report outcome for trace run-xxxx`
- Langfuse may still show LLM spans/tokens because that path is independent (LiteLLM pass-through headers).

How to debug:

1. Find the audit file for the run id:
   - `rg -l 'run-<id>' .salmonloop/runtime/audit/audit-*.json`
2. Inspect Langfuse-related audit events:
   - `jq '.context.auditTrail[] | select(.action|startswith(\"langfuse.outcome.\"))' <audit-file>`

Common causes:

- `langfuse.outcome.http_failed`: LiteLLM `/langfuse/*` route rejected the request (401/403) or proxy returned 500.
  - Some LiteLLM deployments require Basic auth (`any:<litellm_key>`) for `/langfuse/*` routes.
- `langfuse.outcome.request_failed`: network failure or timeout while calling the ingestion endpoint.
- `langfuse.outcome.ingestion_failed`: Langfuse returned per-event ingestion errors (207 multi-status).

## "Grizzco transaction completed: 0/0 files processed"

Meaning: the APPLY step received a diff that validated but did not produce any file operations.

Actions:
- Ensure the patch is a standard git unified diff.
- If the diff starts with `--- a/...` and has no `diff --git`, upgrade to a version that supports headerless unified diffs.

## "repository lacks the necessary blob to perform 3-way merge"

Meaning: `git apply -3` requires valid preimage blob ids from `index <old>..<new>` lines, but the repository does not contain them (often due to fake index lines in generated diffs).

Actions:
- Prefer diffs without `index` lines.
- Use a version that strips unsafe `index` lines or falls back safely.

## "Unexpected end of JSON input" during PATCH

Meaning: the LLM client failed to parse a JSON response (typically a truncated upstream response or a malformed proxy response).

Actions:
- Inspect the latest `.salmonloop/runtime/audit/audit-*.json` and check `meta.errorCode`.
  - Common codes:
    - `LLM_HTTP_RESPONSE_INVALID_JSON`
    - `LLM_HTTP_REQUEST_FAILED`
- If tool calling is enabled, also inspect `context.toolCallingAudit` for argument parsing failures:
  - `toolResultErrorCode: INVALID_TOOL_ARGUMENTS_JSON`
- Retry with `--verbose=extended` and ensure your provider config (base URL, headers, timeouts) is correct.
