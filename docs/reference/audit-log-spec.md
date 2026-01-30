# Audit Log Spec

Audit logs are written to `.s8p/audit/` as JSON.

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
  - `errorStack` (optional)
- `traces` (per-phase timing and error info)
- `context` (sanitized report context)
- `environment` (host info for debugging)

The audit log is designed for post-mortem debugging without requiring verbose console output.

