# Non-Core Test Wait Optimization

**Date**: 2026-03-15
**Status**: Draft

## Summary
Optimize fixed waits in non-core tests (e2e and non-safety integration) using explicit condition waits to reduce idle time without touching safety-critical test coverage.

## Goals
- Reduce unnecessary sleep in non-core tests.
- Preserve safety-critical test coverage and semantics.
- Maintain Windows + Linux/WSL compatibility.

## Non-Goals
- No changes to rollback/merge/checkpoint safety tests.
- No changes to production code or security checks.
- No change to validation semantics, only wait mechanics.

## Scope
Targeted files:
- `tests/integration/a2a-performance-benchmark.test.ts`
- `tests/e2e/cli-e2e.test.ts`
- `tests/e2e/harness.ts`

Excluded:
- Any tests validating rollback, merge safety, checkpoint integrity, or core workspace protection.

## Design
### Strategy
- Replace fixed waits with `waitForCondition`/`waitForPath` where a clear condition exists.
- For intentional timeout tests, keep the minimum wait to preserve behavior.
- Keep assertions unchanged.

### Notes
- A2A performance benchmark delays are used only to simulate minimal processing time. Where safe, reduce delay to minimal yields while preserving concurrency and throughput semantics.
- E2E waits should use observable conditions (audit dir presence, output markers) rather than fixed sleeps.

## Safety Considerations
- No changes to safety-critical test suites.
- No weakening of verification or rollback constraints.

## Testing Plan
- Run `bun run verify` on WSL and Windows after changes.
- Proceed only if all checks pass with zero warnings.

## Rollout
- Implement wait reductions in a2a benchmark and e2e harness.
- Validate on WSL then Windows.
