# Audit Log Spec

Audit logs are written to `.salmonloop/runtime/audit/` as JSON.

## File Naming

- `audit-<ISO-timestamp>.json`

## Top-Level Structure

- `meta`
  - `timestamp`
  - `duration`
  - `success`
  - `lastStep`
  - `error` (string message, optional)
  - `errorName` (optional)
  - `errorCode` (optional, stable error code when available)
  - `errorStack` (optional)
- `traces` (per-phase timing and error info)
  - `name`
  - `start`
  - `end`
  - `duration`
  - `error` (optional)
  - `metadata` (optional)
    - `name` (error name)
    - `code` (generic error code)
    - `llmCode` (LLM-specific error code)
- `context` (sanitized report context)
  - `toolCallingAudit` (optional)
    - A list of tool calling events recorded during `PLAN`/`PATCH`
    - Fields include tool name, argument parse outcome, and redacted previews
  - `auditTrail` (optional)
    - `action`
    - `details`
    - `timestamp`
    - `source`
    - `severity`
    - `scope`
    - `phase`
    - `correlationId`
- `environment` (host info for debugging)

The audit log is designed for post-mortem debugging without requiring verbose console output.

## Allowlist Lock Events

The allowlist subsystem emits audit events for cross-process locking:

- `ALLOWLIST_LOCK_ACQUIRED`
  - `path`
  - `owner`
  - `pid`
  - `waitedMs`
- `ALLOWLIST_LOCK_STALE_REMOVED`
  - `path`
  - `owner` (may be `unknown`)
  - `pid` (may be `undefined`)
  - `ageMs` (may be `undefined`)
- `ALLOWLIST_LOCK_VERIFICATION_FAILED`
  - `path`
  - `owner`
  - `pid`
- `ALLOWLIST_LOCK_RELEASED`
  - `path`
  - `owner`
  - `pid`
- `ALLOWLIST_LOCK_TIMEOUT`
  - `path`

## Allowlist Cache and Safety Events

The allowlist subsystem also emits audit events for cache and safety signals:

- `ALLOWLIST_CACHE_HIT`
  - `path`
  - `hash`
  - `mtimeMs`
  - `size`
- `ALLOWLIST_CACHE_MISS`
  - `path`
  - `cachePath`
- `ALLOWLIST_CACHE_INVALIDATED`
  - `path`
  - `reason`
  - `cachedPath`
  - `cachedHash`
  - `cachedMtimeMs`
  - `cachedSize`
- `ALLOWLIST_CACHE_WRITE_FAILED`
  - `path`
  - `sourcePath`
  - `error`
- `ALLOWLIST_PARSE_FAILED`
  - `path`
  - `error`
- `ALLOWLIST_PATH_BLOCKED`
  - `path`
  - `scope`
- `ALLOWLIST_WRITE_FAILED`
  - `path`
  - `error`
- `ALLOWLIST_ATOMIC_WRITE_FALLBACK`
  - `path`
  - `error`
  - Notes:
    - Indicates a non-atomic write fallback after rename failure.
- `ALLOWLIST_ATOMIC_WRITE_BACKUP_FAILED`
  - `path`
  - `error`
- `ALLOWLIST_ATOMIC_RESTORE_FAILED`
  - `path`
- `ALLOWLIST_TEMP_ARTIFACTS_CLEANED`
  - `path`
  - `count`
- `ALLOWLIST_RULE_PERSISTED`
  - `path`
  - `toolName`
  - `scope`
  - `mode`
  - `phase`
  - `sideEffects`
  - `argsHash`
- `ALLOWLIST_RULE_REMOVED`
  - `path`
  - `toolName`
  - `scope`
  - `phase`
  - `sideEffects`
  - `argsHash`
  - `removedAll`
- `ALLOWLIST_CLEARED`
  - `path`
  - `scope`
- `ALLOWLIST_LOAD_SUMMARY`
  - `scope`
  - `total`
  - `success`
  - `failure`
  - `lastOutcome`
  - `lastSource`
  - `lastError`
  - `lastToolName` (optional)
  - `lastPath` (optional)
  - `toolCount` (optional)
  - `pathCount` (optional)
  - `toolFailureRatePct` (optional, 0-100 with 2 decimal precision)
  - Notes:
    - Summary events are throttled (time/interval-based) to avoid log amplification.
    - Tool/path counters are best-effort and capped with LRU eviction.

## ACP / Checkpoint Lock Events

Checkpoint manifest and ACP session persistence emit lock lifecycle events:

- `checkpoint.manifest.lock.acquire_timeout`
  - `repoPathHash`
- `checkpoint.manifest.lock.stale_reclaimed`
  - `repoPathHash`
- `checkpoint.manifest.lock.corrupted_reclaimed`
  - `ageMs`

- `acp.session.lock.acquire_timeout`
  - `lockPath`
- `acp.session.lock.stale_reclaimed`
  - `lockPath`
- `acp.session.lock.corrupted_reclaimed`
  - `ageMs`

Related ACP persistence/checkpoint events:

- `acp.session.persist.failed`
  - `errorName`
- `acp.session.hydrate.failed`
  - `errorName`
- `acp.checkpoint.read`
  - `sessionId`
  - `repoPathHash`
  - `latestCheckpointId`
  - `hit`
  - `latencyMs`
  - `resumeProbe` (`checkpointId`, `valid`, `reason`)
    - `reason` may be:
      - `ok`
      - `not_found`
      - `manifest_unavailable`
      - `manifest_parse_error`
      - `manifest_io_error`
      - `manifest_lock_timeout`
  - `_meta.salmonloop.resumeHint` / `_meta.salmonloop.resumeHintCode` are returned in ACP
    `session/load` response to provide UI-safe mapping for failed resume probe reasons.

## Permission Decision Events

`permission.decision` events capture high-risk authorization outcomes in a normalized shape:

- `action` (e.g. `context.cache.outside_root`)
- `resource` (target path/resource)
- `risk` (`low|medium|high|critical`)
- `decision` (`allow|deny|pending|challenge`)
- `source` (`policy|cli|user|cache|hook`)
- `requestId` (stable correlation id for deferred authorization)
- `challenge` (short challenge token for interactive confirmation)

## Redaction and Safety

Audit logs are designed to be safe to share for debugging:

- Tool call arguments are redacted and truncated.
- Error messages are truncated.
- Secrets (API keys, tokens, authorization headers, cookies) are redacted when present in recorded payloads.

## Audit Buffer Events

- `audit.dropped`: emitted when low-severity audit events are dropped due to buffer limits.
  - `details.count`: number of dropped events
  - `details.since`: ISO timestamp when drops began (best-effort)
- `audit.dropped.warn`: emitted when dropped events exceed the configured warning threshold.
  - `details.count`: number of dropped events
  - `details.since`: ISO timestamp when drops began (best-effort)

## Redaction Metrics

- `context.redaction.count`: emitted with the number of redaction operations applied during a run.
