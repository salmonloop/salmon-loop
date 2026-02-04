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

## Redaction and Safety

Audit logs are designed to be safe to share for debugging:

- Tool call arguments are redacted and truncated.
- Error messages are truncated.
- Secrets (API keys, tokens, authorization headers, cookies) are redacted when present in recorded payloads.
