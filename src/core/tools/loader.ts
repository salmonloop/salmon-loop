import type { ResolvedExtensions } from '../extensions/types.js';
import { skillToToolSpec } from '../skills/bridge.js';
import { SkillLoader } from '../skills/loader.js';
import type { AuthorizationSourceSummary, ExecutionPhase } from '../types.js';

import { ToolAuditLogger } from './audit.js';
import type { ToolAuthorizationProvider } from './authorization/types.js';
import { BudgetGuard, BudgetConfig } from './budget.js';
import { registerAllBuiltins } from './builtin/index.js';
import { ToolDispatcher } from './dispatcher.js';
import { registerMcpTools } from './mcp/loader.js';
import { registerPluginTools } from './plugins/loader.js';
import { ToolPolicy } from './policy.js';
import { ToolRegistry } from './registry.js';
import { ToolRouter } from './router.js';
import { ToolSanitizer } from './sanitize.js';

export interface ToolstackOptions {
  repoRoot: string;
  persistenceRoot?: string;
  worktreeRoot?: string;
  attemptId: number;
  dryRun: boolean;
  model?: string;
  allowedToolNames?: string[];
  authorizationMode?: 'blocking' | 'deferred';
  budget?: Partial<BudgetConfig>;
  authorizationProvider?: ToolAuthorizationProvider;
  onAuthorizationSummary?: (
    summary: AuthorizationSourceSummary,
    event: {
      callId: string;
      phase: ExecutionPhase;
      toolName: string;
      outcome: string;
      reason?: string;
      source?: string;
      riskLevel?: string;
      sideEffects?: string[];
      ttlMs?: number;
    },
  ) => void;
  extensions?: ResolvedExtensions;
}

/**
 * Creates a fully configured tool stack for SalmonLoop.
 * This is the primary entry point for setting up the tool calling system.
 */
export async function createStandardToolstack(options: ToolstackOptions) {
  // 1. Initialize core components
  let registry = new ToolRegistry();
  const policy = new ToolPolicy();
  const budget = new BudgetGuard(options.budget);
  const audit = new ToolAuditLogger({
    onAuthorizationSummary: options.onAuthorizationSummary,
  });
  const sanitize = new ToolSanitizer();

  // 2. Register all builtin tools (rg, git, ast, ast-grep)
  registerAllBuiltins(registry);

  // 3. Load and register Skills as tools
  const extensions = options.extensions;
  const skillLoader = new SkillLoader({
    repoRoot: options.repoRoot,
    useDefaults: extensions?.skillDiscovery.useDefaults,
    extraPaths: extensions?.skillDiscovery.paths,
  });
  const skills = await skillLoader.initialize();
  for (const skill of skills) {
    registry.register(skillToToolSpec(skill));
  }

  if (Array.isArray(options.allowedToolNames) && options.allowedToolNames.length > 0) {
    const allow = new Set(options.allowedToolNames);
    const filtered = new ToolRegistry();
    for (const name of allow) {
      const spec = registry.getSpec(name);
      if (spec) filtered.register(spec);
    }
    registry = filtered;
  }

  if (extensions) {
    await registerMcpTools(registry, extensions.mcpServers);
    await registerPluginTools(registry, extensions.toolPlugins);
  }

  // 4. Create Router (The execution pipeline)
  const router = new ToolRouter(
    registry,
    policy,
    budget,
    audit,
    sanitize,
    options.authorizationProvider,
    { authorizationMode: options.authorizationMode },
  );

  // 4. Create Dispatcher (The high-level coordinator for LLM text)
  const dispatcher = new ToolDispatcher(router, {
    repoRoot: options.repoRoot,
    persistenceRoot: options.persistenceRoot,
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

export type Toolstack = Awaited<ReturnType<typeof createStandardToolstack>>;
