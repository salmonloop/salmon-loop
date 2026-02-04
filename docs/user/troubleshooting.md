# Troubleshooting

If a run fails, first check the latest audit log in `.salmonloop/runtime/audit/audit-*.json` and look for `meta.errorCode`.
Stable codes are documented in `docs/reference/error-codes.md`.

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
