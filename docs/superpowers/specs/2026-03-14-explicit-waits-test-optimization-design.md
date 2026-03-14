# Explicit Wait Optimization for Integration/E2E Tests

**Date**: 2026-03-14
**Status**: Draft

## Summary
Replace fixed delays in integration and end-to-end tests with explicit, condition-based waits to reduce unnecessary sleep time while preserving all security checks and cross-platform reliability.

## Goals
- Reduce idle time caused by fixed `setTimeout`/`sleep` calls in integration/e2e tests.
- Improve determinism by waiting on observable conditions instead of wall-clock delays.
- Preserve all security validations, authentication checks, and safety constraints.
- Maintain Windows + Linux/WSL compatibility.

## Non-Goals
- No changes to production logic.
- No changes to security enforcement (TLS, token validation, certificate checks, redaction).
- No modification of unit-test event-loop yield patterns (e.g., `setTimeout(0)`).

## Scope
Target integration and e2e test files with fixed delays, including but not limited to:
- `tests/integration/a2a-sdk-server.test.ts`
- `tests/integration/a2a-performance-benchmark.test.ts`
- `tests/integration/checkpoint-robustness.test.ts`
- `tests/integration/checkpoint-manager.test.ts`
- `tests/integration/concurrency.test.ts`
- `tests/integration/merge-robustness.test.ts`
- `tests/integration/snapshot-management.test.ts`
- `tests/integration/limits.test.ts`
- `tests/e2e/cli-e2e.test.ts`

## Design
### Helper API
Add a shared helper for explicit waits, placed under `tests/helpers` and imported by integration/e2e suites.

Proposed API:
- `waitForCondition(check, options)`
  - `check: () => boolean | Promise<boolean>`
  - `options.timeoutMs: number`
  - `options.intervalMs: number`
  - `options.description?: string`

Behavior:
- Polls until `check` returns true or timeout elapses.
- Throws on timeout with a descriptive error.
- If `check` throws, the error is surfaced immediately (no swallowing).

### Replacement Strategy
- Replace fixed waits with `waitForCondition` where a measurable condition exists (file created, state updated, task completed, server reachable, etc.).
- For tests that intentionally validate timeouts, preserve the minimal wait required to trigger the timeout, but avoid inflated delays.
- Do not change security-relevant setups or verification logic; only replace waiting mechanics.

## Safety & Security
- Explicitly avoid disabling TLS checks, auth requirements, or security guards.
- Keep tests aligned with production behaviors and domain semantics.
- Use explicit waits to increase reliability without altering validation coverage.

## Testing Plan
- Run `bun run verify` on WSL and Windows for each optimization step.
- Ensure zero errors or warnings before proceeding to subsequent changes.
- If failures occur, revert and adjust waiting conditions rather than loosening checks.

## Rollout
- Implement helper.
- Replace fixed waits file by file, prioritizing longest delays.
- Validate after each batch.
