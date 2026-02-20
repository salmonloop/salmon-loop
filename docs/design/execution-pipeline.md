# Execution Pipeline

This document describes the execution phases and their responsibilities.

## Phases (Order)

1. PREFLIGHT
2. CONTEXT
3. EXPLORE
4. PLAN
5. PATCH
6. VALIDATE
7. AST_VALIDATE
8. APPLY
9. VERIFY
10. ROLLBACK
11. SHRINK
12. APPLY_BACK

The phase order is a contract and must match runtime behavior.

## Phase Responsibilities

### EXPLORE

- **Goal**: Resolve ambiguous instructions by investigating the codebase.
- **Tools**: Read-only tools (`ls`, `code.search`, `fs.read`).
- **Output**: Enriched `Context` with relevant file contents.
- **Behavior**: Runs a manual tool-calling loop. Files read during this phase are automatically added to the context for the subsequent PLAN phase.

## Side-Effect Boundaries (Summary)

- EXPLORE/PLAN/PATCH are intended to be read-only with tool-calling constrained by policy.
- APPLY mutates the active execution workspace (e.g., a temporary worktree).
- APPLY_BACK mutates the main workspace by synchronizing verified changes from the shadow/worktree run.
- ROLLBACK may be a no-op when verification succeeds; the phase is still present for uniform flow reporting.

## Retry Inputs (PLAN/PATCH)

When VERIFY fails, later attempts may be informed by:

- A refined error summary ("last error") derived from the previous verification output.
- A shrunk/re-ranked context assembled from the failed files and their dependencies.

## Cross-Attempt Control Plane

Phase execution is single-attempt and managed by the typed Pipeline.
Cross-attempt transaction control (retry loops, terminal outcome mapping, attempt-level audit events) is managed by Grizzco flow runner:
`src/core/grizzco/engine/transaction/transaction-runner.ts`.

## PLAN Phase Streaming Behavior

When the configured LLM exposes `chatStream`, the PLAN phase automatically routes through the streaming tool loop. The helper accumulates `contentDelta` chunks into a single assistant turn, aggregates native `tool_calls` so side-effect tooling still executes exactly once per turn, and then feeds the resulting message to the existing governance/audit pipeline. This preserves the read-only contract for PLAN while giving downstream tools and auditors better insight into streaming models that emit partial text or tool invocations before the turn completes.

## Config Overrides for Base URL and Model

LLM adapters normalized by `resolveConfig` now accept the preferred environment variables `SALMONLOOP_BASE_URL` and `SALMONLOOP_MODEL` (falling back to `S8P_BASE_URL` and `S8P_MODEL` for backward compatibility). The runtime trims trailing slashes from the base URL before handing it to the transport so users can copy providers' publishable URLs (e.g., `https://openrouter.ai/api/v1/`) without worrying about duplicates.

## Error Transparency

`toLlmError` now retains the provider payload—status code, response body, and any nested `data.error.message`—and surfaces this metadata through the emitted `LlmError.meta`. The CLI/Audit output can therefore quote the raw HTTP response when PLAN/PATCH fails, so 403/TLS/other transport failures stay faithful to the original provider message instead of relying on inferred explanations.
