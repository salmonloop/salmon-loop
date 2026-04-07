import { describe, it, expect, mock } from 'bun:test';

import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';
import type { ToolSpec } from '../../../src/core/tools/types.js';

describe('ToolRouter.isHighRiskTool', () => {
  function createRouter(): ToolRouter {
    const registry = { getSpec: mock() } as unknown as ToolRegistry;
    const policy = { decide: mock() } as unknown as ToolPolicy;
    const budget = { runWithGuards: mock() } as unknown as BudgetGuard;
    const audit = { onStart: mock(), onEnd: mock(), onAuthorization: mock() } as unknown as ToolAuditLogger;
    const sanitizer = { validateInput: mock(), sanitizeOutput: mock() } as unknown as ToolSanitizer;
    return new ToolRouter(registry, policy, budget, audit, sanitizer);
  }

  function callIsHighRisk(router: ToolRouter, spec: Partial<ToolSpec>): boolean {
    return (router as any).isHighRiskTool(spec);
  }

  it('should return true when sideEffects includes "process"', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: ['process'] })).toBe(true);
  });

  it('should return true when sideEffects includes "fs_write"', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: ['fs_write'] })).toBe(true);
  });

  it('should return true when sideEffects includes "network"', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: ['network'] })).toBe(true);
  });

  it('should return true when sideEffects includes multiple high-risk effects', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: ['process', 'network'] })).toBe(true);
  });

  it('should return false for read-only side effects', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: ['fs_read'] })).toBe(false);
    expect(callIsHighRisk(router, { sideEffects: ['git_read'] })).toBe(false);
    expect(callIsHighRisk(router, { sideEffects: ['none'] })).toBe(false);
  });

  it('should return false for empty sideEffects array', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: [] })).toBe(false);
  });

  it('should return false when sideEffects is undefined (defensive)', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, {})).toBe(false);
  });

  it('should return true when high-risk effect is mixed with low-risk effects', () => {
    const router = createRouter();
    expect(callIsHighRisk(router, { sideEffects: ['fs_read', 'fs_write', 'git_read'] })).toBe(true);
  });
});
