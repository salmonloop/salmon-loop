import { ToolAuditLogger } from './audit';
import { BudgetGuard, BudgetConfig } from './budget';
import { registerAllBuiltins } from './builtin/index';
import { ToolDispatcher } from './dispatcher';
import { ToolPolicy } from './policy';
import { ToolRegistry } from './registry';
import { ToolRouter } from './router';
import { ToolSanitizer } from './sanitize';

export interface ToolstackOptions {
  repoRoot: string;
  worktreeRoot?: string;
  attemptId: number;
  dryRun: boolean;
  model?: string;
  budget?: Partial<BudgetConfig>;
}

/**
 * Creates a fully configured tool stack for SalmonLoop.
 * This is the primary entry point for setting up the tool calling system.
 */
export function createStandardToolstack(options: ToolstackOptions) {
  // 1. Initialize core components
  const registry = new ToolRegistry();
  const policy = new ToolPolicy();
  const budget = new BudgetGuard(options.budget);
  const audit = new ToolAuditLogger();
  const sanitize = new ToolSanitizer();

  // 2. Register all builtin tools (rg, git, ast, ast-grep)
  registerAllBuiltins(registry);

  // 3. Create Router (The execution pipeline)
  const router = new ToolRouter(registry, policy, budget, audit, sanitize);

  // 4. Create Dispatcher (The high-level coordinator for LLM text)
  const dispatcher = new ToolDispatcher(router, {
    repoRoot: options.repoRoot,
    worktreeRoot: options.worktreeRoot,
    attemptId: options.attemptId,
    dryRun: options.dryRun,
    model: options.model,
  });

  return {
    registry,
    router,
    dispatcher,
    budget,
    audit,
    policy,
    sanitize,
  };
}
