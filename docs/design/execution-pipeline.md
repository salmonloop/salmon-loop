# Execution Pipeline

This document describes the execution phases and their responsibilities.

## Phases (Order)

1. PREFLIGHT
2. CONTEXT
3. PLAN
4. PATCH
5. VALIDATE
6. AST_VALIDATE
7. APPLY
8. VERIFY
9. ROLLBACK
10. SHRINK

The phase order is a contract and must match runtime behavior.

## Side-Effect Boundaries (Summary)

- PLAN/PATCH are intended to be read-only with tool-calling constrained by policy.
- APPLY mutates the active execution workspace (e.g., a temporary worktree).
- ROLLBACK may be a no-op when verification succeeds; the phase is still present for uniform flow reporting.

## Retry Inputs (PLAN/PATCH)

When VERIFY fails, later attempts may be informed by:
- A refined error summary ("last error") derived from the previous verification output.
- A shrunk/re-ranked context assembled from the failed files and their dependencies.

## PLAN Phase Streaming Behavior

When the configured LLM exposes `chatStream`, the PLAN phase automatically routes through the streaming tool loop. The helper accumulates `contentDelta` chunks into a single assistant turn, aggregates native `tool_calls` so side-effect tooling still executes exactly once per turn, and then feeds the resulting message to the existing governance/audit pipeline. This preserves the read-only contract for PLAN while giving downstream tools and auditors better insight into streaming models that emit partial text or tool invocations before the turn completes.

## Config Overrides for Base URL and Model

LLM adapters normalized by `resolveConfig` now accept the preferred environment variables `SALMONLOOP_BASE_URL` and `SALMONLOOP_MODEL` (falling back to `S8P_BASE_URL`/`SALMON_BASE_URL` and `S8P_MODEL`/`SALMON_MODEL` for backward compatibility). The runtime trims trailing slashes from the base URL before handing it to the transport so users can copy providers' publishable URLs (e.g., `https://openrouter.ai/api/v1/`) without worrying about duplicates.
