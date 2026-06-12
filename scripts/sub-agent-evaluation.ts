/**
 * Sub-Agent Evaluation Harness
 *
 * Runs sub-agent dispatch tasks through the real runSalmonLoop pipeline
 * to verify end-to-end correctness. Supports two modes:
 *
 *   --mode=stub  (default): Uses ToolCallingStubLLM for fast, deterministic validation
 *   --mode=real            : Uses real LLM API (requires API key)
 *
 * Usage:
 *   npx tsx scripts/sub-agent-evaluation.ts [--mode=stub|real] [--filter=tag] [--verbose]
 */

import path from 'path';

import { createLogger, setLogger } from '../src/core/observability/logger.js';
import { createMonitor, setMonitor } from '../src/core/observability/monitor.js';
import { createPluginRegistry, setPluginRegistry } from '../src/core/plugin/registry.js';
import { createPromptRegistry, setPromptRegistry } from '../src/core/prompts/registry.js';
import { registerDefaultSubAgentProfiles } from '../src/core/sub-agent/registry-defaults.js';
import { createSubAgentRegistry, setSubAgentRegistry } from '../src/core/sub-agent/registry.js';

import { createSalmonLoopProvider, resolveRealLlm } from './eval/providers/salmon-loop.js';
import { buildFilter, runHarness } from './eval/run.js';

async function main(): Promise<void> {
  process.stderr.write('[eval] starting initialization...\n');
  setLogger(createLogger({ silent: true }));
  setMonitor(createMonitor());
  const subAgentRegistry = createSubAgentRegistry();
  registerDefaultSubAgentProfiles(subAgentRegistry);
  setSubAgentRegistry(subAgentRegistry);
  const pluginRegistry = createPluginRegistry();
  setPluginRegistry(pluginRegistry);
  setPromptRegistry(createPromptRegistry());
  process.stderr.write('[eval] initialization done\n');

  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'stub';
  const filterArg = args.find((a) => a.startsWith('--filter='))?.split('=')[1];
  const verbose = args.includes('--verbose');

  // Resolve LLM for real mode
  const realLlm = mode === 'real' ? await resolveRealLlm() : undefined;
  if (realLlm) {
    process.stderr.write(`[eval] real LLM mode: sub-agents inherit same model\n`);
  }

  // Create provider
  const provider = createSalmonLoopProvider(realLlm);

  // Resolve tasks path
  const scriptDir = typeof import.meta.dir !== 'undefined'
    ? import.meta.dir
    : path.dirname(new URL(import.meta.url).pathname);
  const tasksPath = path.join(scriptDir, 'sub-agent-eval-tasks.json');
  const reportPath = path.join(scriptDir, 'sub-agent-eval-report.json');

  // Run
  const report = await runHarness({
    provider,
    tasksSource: tasksPath,
    runOptions: { mode: mode as 'stub' | 'real', verbose, filter: buildFilter(filterArg) },
    reportPath,
    rateLimitMs: realLlm ? 5000 : 0,
  });

  if (report.failedTasks > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
