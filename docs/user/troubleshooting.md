# Troubleshooting

If a run fails, first check the latest audit log in `.salmonloop/runtime/audit/audit-*.json` (default repo scope) or `~/.salmonloop/runtime/audit/audit-*.json` (user scope) and look for `meta.errorCode`.
Stable codes are documented in `docs/reference/error-codes.md`.

## Langfuse outcome reporting failed

Symptom:

- The CLI prints: `[Langfuse] Failed to report outcome for trace run-xxxx`
- Langfuse may still show LLM spans/tokens because that path is independent (LiteLLM pass-through headers).

How to debug:

1. Find the audit file for the run id:
   - Repo scope: `rg -l 'run-<id>' .salmonloop/runtime/audit/audit-*.json`
   - User scope: `rg -l 'run-<id>' ~/.salmonloop/runtime/audit/audit-*.json`
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
- Inspect the latest audit log (repo scope: `.salmonloop/runtime/audit/audit-*.json`, user scope: `~/.salmonloop/runtime/audit/audit-*.json`) and check `meta.errorCode`.
  - Common codes:
    - `LLM_HTTP_RESPONSE_INVALID_JSON`
    - `LLM_HTTP_REQUEST_FAILED`
- If tool calling is enabled, also inspect `context.toolCallingAudit` for argument parsing failures:
  - `toolResultErrorCode: INVALID_TOOL_ARGUMENTS_JSON`
- Retry with `--verbose=extended` and ensure your provider config (base URL, headers, timeouts) is correct.

## ACP / Checkpoint lock troubleshooting

When ACP session persistence or checkpoint manifest writes are blocked, inspect audit events first.

Quick commands:

1. Find latest audit:
   - Repo scope: `ls -t .salmonloop/runtime/audit/audit-*.json | head -n 1`
   - User scope: `ls -t ~/.salmonloop/runtime/audit/audit-*.json | head -n 1`
2. Filter lock-related events:
   - `jq '.context.auditTrail[] | select(.action|test("acp\\.session\\.lock|checkpoint\\.manifest\\.lock"))' <audit-file>`

Event to action mapping:

- `acp.session.lock.acquire_timeout`
  - Meaning: ACP session store lock was not acquired within retry budget.
  - Action: ensure no other long-running ACP process is holding the lock; restart stale ACP servers.
- `acp.session.lock.stale_reclaimed`
  - Meaning: stale ACP lock was reclaimed after age/liveness checks.
  - Action: usually safe; if frequent, inspect abnormal ACP exits.
- `acp.session.lock.corrupted_reclaimed`
  - Meaning: lock payload could not be parsed and was reclaimed by mtime fallback.
  - Action: check filesystem reliability and abrupt process termination patterns.

- `checkpoint.manifest.lock.acquire_timeout`
  - Meaning: checkpoint manifest lock contention exceeded retry budget.
  - Action: inspect concurrent checkpoint writers; reduce overlap of parallel runs on same repo.
- `checkpoint.manifest.lock.stale_reclaimed`
  - Meaning: stale manifest lock was reclaimed.
  - Action: usually safe; monitor for repeated crashes.
- `checkpoint.manifest.lock.corrupted_reclaimed`
  - Meaning: corrupted lock payload was reclaimed via mtime fallback.
  - Action: inspect host fs health and forced termination signals.

Related ACP recovery events:

- `acp.session.persist.failed`: ACP session snapshot could not be persisted.
- `acp.session.hydrate.failed`: ACP session snapshot could not be loaded during startup.
- `acp.checkpoint.read`: includes `resumeProbe.reason` for checkpoint availability (`ok|not_found|manifest_unavailable`).
