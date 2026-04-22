# Serve Protocol FlowMode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `serve`, ACP, and A2A route protocol-standard selectors into internal `FlowMode`, defaulting server execution to `autopilot` without exposing permission semantics as protocol modes.

**Architecture:** Add one shared protocol mapping layer under `src/core/protocols/shared/`, then migrate ACP session mode handling and A2A skill handling to use that layer. Keep `permissionMode` server-local and continue passing it only through authorization wiring. Do not add custom protocol fields or alter the execution kernel contract.

**Tech Stack:** TypeScript, Bun test runner, Commander CLI, ACP SDK integration, A2A SDK integration, Grizzco execution engine

---

### Task 1: Introduce a shared protocol-to-flow mapping layer

**Files:**
- Create: `src/core/protocols/shared/flow-mode-mapping.ts`
- Test: `tests/unit/core/protocols/shared/flow-mode-mapping.test.ts`

**Step 1: Write the failing unit tests**

Add tests that lock:

- ACP mode ids matching supported flow modes parse successfully
- legacy ACP values `interactive` and `yolo` degrade to `autopilot`
- unknown ACP mode ids return `undefined`
- A2A skill ids map to supported flow modes

Use explicit expectations like:

```ts
expect(parseAcpFlowMode('autopilot')).toBe('autopilot');
expect(parseAcpFlowMode('interactive')).toBe('autopilot');
expect(parseA2ASkillFlowMode('review')).toBe('review');
expect(parseA2ASkillFlowMode('unknown')).toBeUndefined();
```

**Step 2: Run the targeted tests to verify RED**

Run:

```bash
bun test --preload ./tests/setup-bun.ts tests/unit/core/protocols/shared/flow-mode-mapping.test.ts
```

Expected: FAIL because the mapper does not exist yet.

**Step 3: Write the minimal implementation**

Implement pure helpers only:

- `SUPPORTED_PROTOCOL_FLOW_MODES`
- `parseAcpFlowMode(value)`
- `parseA2ASkillFlowMode(value)`
- `buildA2AFlowSkills()`

Keep the implementation DRY by reusing `parseFlowMode()` where possible.

**Step 4: Run the targeted tests to verify GREEN**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add src/core/protocols/shared/flow-mode-mapping.ts tests/unit/core/protocols/shared/flow-mode-mapping.test.ts
git commit -m "feat: add protocol flow mode mapper"
```

### Task 2: Migrate ACP session mode semantics from permission mode to flow mode

**Files:**
- Modify: `src/core/protocols/acp/formal-agent.ts`
- Test: `tests/unit/core/protocols/acp/formal-agent.test.ts`
- Verify: `tests/integration/acp-session-persistence.test.ts`

**Step 1: Write the failing ACP unit tests**

Extend ACP tests to prove:

- default ACP mode is `autopilot`
- supported ACP modes are execution flow modes, not `interactive|yolo`
- legacy stored ACP modes recover as `autopilot`
- execution request creation uses the current ACP flow mode instead of hardcoded `patch`

**Step 2: Run the targeted ACP tests to verify RED**

Run:

```bash
bun test --preload ./tests/setup-bun.ts tests/unit/core/protocols/acp/formal-agent.test.ts tests/integration/acp-session-persistence.test.ts
```

Expected: FAIL because ACP still persists permission-mode semantics and task creation still hardcodes `patch`.

**Step 3: Write the minimal implementation**

In `formal-agent.ts`:

- replace ACP session `modeId` typing/wiring to use flow-backed values
- use the shared protocol flow mapper for parsing and legacy recovery
- update session mode listing/current mode update builders accordingly
- change execution request creation to use the resolved ACP flow mode instead of `'patch'`

Do not change authorization policy wiring beyond removing dependence on ACP `modeId`.

**Step 4: Run the targeted ACP tests to verify GREEN**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add src/core/protocols/acp/formal-agent.ts tests/unit/core/protocols/acp/formal-agent.test.ts tests/integration/acp-session-persistence.test.ts
git commit -m "refactor: map ACP session modes to flow modes"
```

### Task 3: Migrate A2A skill exposure and execution to flow-backed skills

**Files:**
- Modify: `src/cli/commands/serve.ts`
- Modify: `src/core/protocols/a2a/sdk/executor.ts`
- Modify: `src/core/protocols/a2a/agent-card.ts`
- Test: `tests/unit/core/protocols/a2a/agent-card.test.ts`
- Test: `tests/unit/core/protocols/a2a/sdk/executor.test.ts`
- Verify: `tests/integration/a2a-sdk-server.test.ts`

**Step 1: Write the failing A2A tests**

Lock these behaviors:

- agent card exposes flow-backed skills including `autopilot`
- executor defaults to `autopilot` when no supported skill is selected
- executor maps explicit flow-backed skill ids to internal `FlowMode`

**Step 2: Run the targeted A2A tests to verify RED**

Run:

```bash
bun test --preload ./tests/setup-bun.ts tests/unit/core/protocols/a2a/agent-card.test.ts tests/unit/core/protocols/a2a/sdk/executor.test.ts tests/integration/a2a-sdk-server.test.ts
```

Expected: FAIL because `serve` still advertises only `patch` and executor still defaults to `patch`.

**Step 3: Write the minimal implementation**

Use the shared mapper to:

- build A2A skill declarations from supported flow modes
- resolve selected skill id to `FlowMode`
- default unresolved execution to `autopilot`

Keep protocol `capabilities` untouched.

**Step 4: Run the targeted A2A tests to verify GREEN**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/serve.ts src/core/protocols/a2a/sdk/executor.ts src/core/protocols/a2a/agent-card.ts tests/unit/core/protocols/a2a/agent-card.test.ts tests/unit/core/protocols/a2a/sdk/executor.test.ts tests/integration/a2a-sdk-server.test.ts
git commit -m "feat: route A2A skills through flow modes"
```

### Task 4: Align `serve` wiring defaults with `autopilot`

**Files:**
- Modify: `src/cli/commands/serve.ts`
- Test: `tests/unit/cli/commands/serve.test.ts`
- Verify: ACP/A2A integration tests already touched above

**Step 1: Write the failing serve wiring tests**

Add tests that prove:

- ACP default mode id passed into the formal agent is `autopilot`
- A2A-facing default skill set includes `autopilot`
- `resolvedConfig.permissionMode` still flows only into authorization provider wiring

**Step 2: Run the targeted tests to verify RED**

Run:

```bash
bun test --preload ./tests/setup-bun.ts tests/unit/cli/commands/serve.test.ts
```

Expected: FAIL because `serve` still passes `resolvedConfig.permissionMode` into ACP mode wiring and still exposes only `patch`.

**Step 3: Write the minimal implementation**

Update `serve.ts` so that:

- protocol-facing flow default is `autopilot`
- ACP `defaultModeId` is `autopilot`
- A2A exposed skills come from the shared flow-skill builder
- permission defaults remain local to authorization provider construction

**Step 4: Run the targeted tests to verify GREEN**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/serve.ts tests/unit/cli/commands/serve.test.ts
git commit -m "fix: align serve defaults with autopilot flow"
```

### Task 5: Run focused regression suite and typecheck

**Files:**
- Verify only: `tests/unit/core/protocols/shared/flow-mode-mapping.test.ts`
- Verify only: `tests/unit/core/protocols/acp/formal-agent.test.ts`
- Verify only: `tests/integration/acp-session-persistence.test.ts`
- Verify only: `tests/unit/core/protocols/a2a/agent-card.test.ts`
- Verify only: `tests/unit/core/protocols/a2a/sdk/executor.test.ts`
- Verify only: `tests/integration/a2a-sdk-server.test.ts`
- Verify only: `tests/unit/cli/commands/serve.test.ts`

**Step 1: Run the focused regression suite**

Run:

```bash
bun test --preload ./tests/setup-bun.ts tests/unit/core/protocols/shared/flow-mode-mapping.test.ts tests/unit/core/protocols/acp/formal-agent.test.ts tests/integration/acp-session-persistence.test.ts tests/unit/core/protocols/a2a/agent-card.test.ts tests/unit/core/protocols/a2a/sdk/executor.test.ts tests/integration/a2a-sdk-server.test.ts tests/unit/cli/commands/serve.test.ts
```

Expected: PASS

**Step 2: Run a broader serve/autopilot safety sweep**

Run:

```bash
bun test --preload ./tests/setup-bun.ts tests/unit/cli/commands/run/mode.test.ts tests/unit/cli/commands/chat-outcome-reporter.test.ts tests/unit/cli/commands/run-outcome-reporter.test.ts tests/unit/core/runtime/execution-profile.test.ts tests/unit/core/grizzco/steps/preflight.test.ts tests/unit/tools/policy.test.ts tests/unit/tools/tool-visibility.test.ts
```

Expected: PASS

**Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: align serve protocol flow selection with autopilot"
```
