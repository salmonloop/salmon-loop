# Integration Retry Wait Optimization

**Date**: 2026-03-15
**Status**: Draft

## Summary
Replace fixed retry backoff sleeps in integration tests with condition-based polling to reduce idle time while preserving safety guarantees and cross-platform stability.

## Goals
- Reduce integration test time wasted in fixed retry delays.
- Preserve all safety constraints that protect the target workspace.
- Maintain Windows and Linux/WSL compatibility.

## Non-Goals
- No changes to production code.
- No changes to security checks, rollback logic, or execution contract behavior.
- No changes to performance benchmark tests.

## Scope
Integration test updates only, primarily:
- `tests/integration/checkpoint-manager.test.ts`
- `tests/integration/merge-robustness.test.ts`

## Design
### Strategy
- Replace exponential backoff sleeps with explicit condition polling.
- Use `waitForCondition` with a bounded timeout and short interval.
- Keep existing error handling; do not swallow exceptions.

### Targeted Changes
- Git init retries: poll for `.git` availability or a successful git command instead of fixed sleep.
- Windows file write retries: poll for write success with short interval and upper bound.
- Teardown cleanup delay: remove fixed sleep, rely on retryable delete with bounded polling.

## Safety Considerations
- Only test code is modified; production logic remains unchanged.
- Safety-related assertions and validations remain intact.
- All changes are compatible with the execution contract and do not reduce protections.

## Testing Plan
- Run `bun run verify` on WSL and Windows after changes.
- Proceed only if all checks pass with zero warnings.

## Rollout
- Implement helper usage in the two integration files.
- Validate, then iterate if more wait sites are identified.
