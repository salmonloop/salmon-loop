# Execution Limits Implementation

This document outlines the implementation details of execution limits in SalmonLoop to prevent runaway processes and manage resource consumption.

## Core Mechanisms

Execution limits are enforced at multiple levels to ensure system stability and defensive operation.

### Time-based Limits

- **Total Execution Timeout**: Maximum time allowed for a single `SalmonLoop` run.
- **Phase Timeout**: Individual phases (Plan, Patch, Verify) have their own configurable timeouts.
- **LLM Call Timeout**: Protection against hanging API calls.

### Iteration-based Limits

- **Max Retries**: The loop will terminate after a specified number of failed attempts to fix an issue.
- **Context Shrinking Limits**: Limits on how many times context window reduction can occur.

### Resource-based Limits

- **Memory Monitoring**: The loop monitors its own memory usage and terminates if thresholds are exceeded.
- **Diff Size Limits**: Safety check before applying patches to prevent massive unintended changes.

## Configuration

Limits are configured via `ExecutionLimits` in `src/core/types.ts`.

```typescript
export interface ExecutionLimits {
  maxRetries: number;
  totalTimeoutMs: number;
  phaseTimeoutMs: number;
  maxDiffSizeBytes: number;
  memoryLimitBytes: number;
}
```

## Defensive Checks

The `Monitor` class is responsible for tracking these limits during execution. If any limit is breached:

1. Current operations are halted.
2. The system attempts a safe rollback (if in a worktree or if checkpointing is active).
3. A detailed error is returned via the `SalmonLoopResult`.

## Recent Improvements (Stage 10)

In Stage 10, we've enhanced these limits with:
- **Dirty Workspace Protection**: Ensuring existing changes are stashed or isolated in worktrees.
- **Failure Rate Monitoring**: Tracking checkpoint and cleanup failures to identify infrastructure issues.
