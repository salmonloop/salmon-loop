import { text } from '../../locales/index.js';
import type { ResolvedExtensions } from '../extensions/types.js';
import { skillToToolSpec, type RouterBox } from '../skills/bridge.js';
import { SkillLoader } from '../skills/loader.js';
import type { AuthorizationSourceSummary, ExecutionPhase } from '../types/runtime.js';

import { ToolAuditLogger } from './audit.js';
import type { ToolAuthorizationProvider } from './authorization/types.js';
import { BudgetGuard, BudgetConfig } from './budget.js';
import { registerAllBuiltins } from './builtin/index.js';
import { ToolDispatcher } from './dispatcher.js';
import { registerMcpTools } from './mcp/loader.js';
import {
  compilePermissionRules,
  getVisibleToolNamesFromAllowRules,
  shouldFilterRegistryByAllowRules,
} from './permissions/permission-rules.js';
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
  permissionRules?: import('./permissions/permission-rules.js').RawPermissionRulesInput;
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
      persist?: 'repo' | 'user';
    },
  ) => void;
  onAuthorizationDecision?: (event: {
    callId: string;
    phase: ExecutionPhase;
    toolName: string;
    outcome: string;
    reason?: string;
    source?: string;
    riskLevel?: string;
    sideEffects?: string[];
    ttlMs?: number;
    persist?: 'repo' | 'user';
  }) => void;
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
    onAuthorizationDecision: options.onAuthorizationDecision,
  });
  const sanitize = new ToolSanitizer();

  // 2. Register all builtin tools (rg, git, ast, ast-grep)
  registerAllBuiltins(registry);

  const compiledPermissionRules = (() => {
    if (!options.permissionRules) return undefined;
    const compiled = compilePermissionRules(options.permissionRules);
    if (!compiled.ok) {
      const summary = (compiled.errors ?? []).map((e) => `${e.raw}: ${e.message}`).slice(0, 5);
      throw new Error(text.tools.permissionRulesParseFailed(summary.join('; ')));
    }
    return compiled.compiled;
  })();

  // 3. Register ALL tools (builtins already done above) into the registry,
  //    then apply allowlist/permission filtering, then create the router.
  //
  //    The challenge: skill executors need a ToolRouter reference (to call
  //    shell.exec through governance), but the router needs the final filtered
  //    registry. We break this cycle with a RouterBox — a mutable container
  //    whose .router field is filled after the router is constructed.
  //
  //    Order:
  //      a. Create RouterBox (null initially)
  //      b. Load skills → register with RouterBox (executor reads lazily)
  //      c. Register MCP + plugin tools
  //      d. Apply allowlist/permission filtering → new filtered registry
  //      e. Create ToolRouter with filtered registry
  //      f. Fill RouterBox.router — skill executors now have a valid reference

  const routerBox: RouterBox = { router: null };

  // 3a. Load skill catalog (Tier 1: lightweight metadata only) and register
  //     bridge tool specs with lazy activation. Full skill content is loaded
  //     on demand via SkillLoader.activateSkill() (Tier 2) when the executor
  //     is actually invoked.
  // @see https://agentskills.io/specification — Progressive disclosure
  const extensions = options.extensions;
  const skillLoader = new SkillLoader({
    repoRoot: options.repoRoot,
    useDefaults: extensions?.skillDiscovery.useDefaults,
    extraPaths: extensions?.skillDiscovery.paths,
    legacyDirectMd: extensions?.skillDiscovery.legacyDirectMd,
  });
  const catalog = await skillLoader.loadCatalog();
  for (const entry of catalog) {
    registry.register(skillToToolSpec(
      { entry, loader: skillLoader },
      routerBox,
    ));
  }

  // 3b. Register MCP + plugin tools
  if (extensions) {
    await registerMcpTools(registry, extensions.mcpServers);
    await registerPluginTools(registry, extensions.toolPlugins);
  }

  // 3c. Apply allowlist / permission-rule filtering — skills are now included
  const allowSets: Array<Set<string>> = [];
  if (Array.isArray(options.allowedToolNames) && options.allowedToolNames.length > 0) {
    allowSets.push(new Set(options.allowedToolNames));
  }
  if (shouldFilterRegistryByAllowRules(compiledPermissionRules)) {
    allowSets.push(getVisibleToolNamesFromAllowRules(compiledPermissionRules));
  }

  if (allowSets.length > 0) {
    const intersect = new Set<string>(allowSets[0]);
    for (const next of allowSets.slice(1)) {
      for (const name of Array.from(intersect)) {
        if (!next.has(name)) intersect.delete(name);
      }
    }

    const filtered = new ToolRegistry();
    for (const name of intersect) {
      const spec = registry.getSpec(name);
      if (spec) filtered.register(spec);
    }
    registry = filtered;
  }

  // 3d. Create Router with the FINAL (filtered) registry — skills included
  const router = new ToolRouter(
    registry,
    policy,
    budget,
    audit,
    sanitize,
    options.authorizationProvider,
    { authorizationMode: options.authorizationMode, permissionRules: compiledPermissionRules },
  );

  // 3e. Fill the RouterBox — skill executors can now resolve the router
  routerBox.router = router;

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
