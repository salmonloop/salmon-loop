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

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { ToolCallingStubLLM, type StubTurn } from '../src/core/llm/tool-calling-stub.js';
import { clearLogger, createLogger, setLogger } from '../src/core/observability/logger.js';
import { clearMonitor, createMonitor, setMonitor } from '../src/core/observability/monitor.js';
import {
  clearPluginRegistry,
  createPluginRegistry,
  setPluginRegistry,
} from '../src/core/plugin/registry.js';
import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../src/core/prompts/registry.js';
import { runSalmonLoop } from '../src/core/runtime/loop.js';
import { createSubAgentController } from '../src/core/sub-agent/controller.js';
import type { SubAgentControllerPort } from '../src/core/sub-agent/controller.js';
import { registerDefaultSubAgentProfiles } from '../src/core/sub-agent/registry-defaults.js';
import {
  clearSubAgentRegistry,
  createSubAgentRegistry,
  setSubAgentRegistry,
} from '../src/core/sub-agent/registry.js';
import type { LLM } from '../src/core/types/llm.js';
import type { LoopResult } from '../src/core/types/loop.js';

// ─── Types ───

interface TaskDefinition {
  id: string;
  profile: string;
  sessionTarget: 'isolated' | 'shared' | 'fork';
  dispatchMode: 'sync' | 'async' | 'fire-and-forget';
  complexity: 'simple' | 'medium' | 'complex';
  task: string;
  expectedBehavior: {
    minToolCalls: number;
    maxToolCalls: number;
    shouldComplete: boolean;
  };
  tags: string[];
}

interface EvalResult {
  taskId: string;
  profile: string;
  dispatchMode: string;
  complexity: string;
  success: boolean;
  reasonCode: string;
  attempts: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  agentCount: number;
  agentToolCalls: number;
  agentTokenUsage: number;
  durationMs: number;
  error?: string;
}

interface EvalReport {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  avgDurationMs: number;
  avgTokenUsage: number;
  byProfile: Record<string, { total: number; success: number; failed: number }>;
  byComplexity: Record<string, { total: number; success: number; failed: number }>;
  results: EvalResult[];
}

// ─── Helpers ───

async function execCommand(cwd: string, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'ignore' });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
    child.on('error', reject);
  });
}

async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sub-agent-eval-'));
  await execCommand(dir, 'git', ['init']);
  await execCommand(dir, 'git', ['config', 'user.email', 'eval@test']);
  await execCommand(dir, 'git', ['config', 'user.name', 'Eval']);
  // Create a minimal file so the repo isn't empty
  const { writeFile } = await import('fs/promises');
  await writeFile(path.join(dir, 'README.md'), '# Eval Repo\n');
  await writeFile(path.join(dir, '.gitignore'), '.salmonloop/\n');
  await execCommand(dir, 'git', ['add', '.']);
  await execCommand(dir, 'git', ['commit', '-m', 'init']);
  return dir;
}

// ─── Stub Builder ───

function buildValidDiff(task: TaskDefinition): string {
  // Canonical git diff format (diff --git header required by extractUnifiedDiffFromLLMContent)
  return `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Eval Repo
+Updated by ${task.profile} sub-agent
`;
}

function buildSubAgentStubTurns(task: TaskDefinition): StubTurn[] {
  const planJson = JSON.stringify({
    goal: `Complete: ${task.task}`,
    files: ['README.md'],
    changes: [`Executed ${task.profile} task`],
    verify: 'echo ok',
  });

  const needsPatch = task.profile === 'surgeon' || task.profile === 'cleaner';

  return [
    // PLAN step: plan JSON (consumed by chatWithTools → parsePlanFromLLMContent)
    { content: planJson },
    // PATCH step (surgeon/cleaner only): valid unified diff
    ...(needsPatch ? [{ content: buildValidDiff(task) }] : []),
    // Buffer for any unexpected LLM calls
    { content: 'ok' },
    { content: 'ok' },
  ];
}

function buildSingleAttemptTurns(task: TaskDefinition): StubTurn[] {
  const dispatchArgs = {
    agent_ref: task.profile,
    task: task.task,
    session_target: task.sessionTarget,
    expected_output:
      task.profile === 'surgeon' || task.profile === 'cleaner'
        ? 'patch'
        : task.profile === 'reviewer'
          ? 'review'
          : 'diagnosis',
    ...(task.dispatchMode === 'async' ? { async: true } : {}),
  };

  const dispatchCallId = `call-dispatch-${randomUUID().slice(0, 8)}`;

  const planJson = JSON.stringify({
    goal: `Complete: ${task.task}`,
    files: ['README.md'],
    changes: [`Dispatched ${task.profile} sub-agent`],
    verify: 'echo ok',
  });

  const awaitCallId = `call-await-${randomUUID().slice(0, 8)}`;

  return [
    // EXPLORE phase (2 LLM calls via chatWithTools: tool call + text)
    {
      content: 'Reading README.md.',
      toolCalls: [
        {
          id: `call-read-${randomUUID().slice(0, 8)}`,
          function: { name: 'fs.read', arguments: JSON.stringify({ file_path: 'README.md' }) },
        },
      ],
    },
    { content: 'Exploration complete.' },

    // PLAN phase — agent_dispatch triggers sub-agent's SmallfryLoop
    {
      content: `Dispatching ${task.profile} sub-agent.`,
      toolCalls: [
        {
          id: dispatchCallId,
          function: {
            name: 'agent_dispatch',
            arguments: JSON.stringify(dispatchArgs),
          },
        },
      ],
    },

    // For async mode: agent_await blocks until the sub-agent completes.
    ...(task.dispatchMode === 'async'
      ? [
          {
            content: 'Awaiting sub-agent result.',
            toolCalls: [
              {
                id: awaitCallId,
                function: {
                  name: 'agent_await',
                  arguments: JSON.stringify({ agentId: '{{handle}}' }),
                },
              },
            ],
          },
        ]
      : []),

    // Main pipeline PLAN round: plan JSON (sub-agent uses its own StubLLM via llmFactory)
    { content: planJson },

    // PATCH phase: valid unified diff
    { content: buildValidDiff(task) },
  ];
}

function buildStubTurns(task: TaskDefinition): StubTurn[] {
  // Generate enough turns for the initial attempt + up to 2 retries.
  // Each retry restarts the pipeline from EXPLORE.
  const allTurns: StubTurn[] = [];
  for (let i = 0; i < 3; i++) {
    allTurns.push(...buildSingleAttemptTurns(task));
  }
  return allTurns;
}

// ─── Harness ───

const TASK_TIMEOUT_MS = 10_000;

async function runCase(task: TaskDefinition, verbose: boolean): Promise<EvalResult> {
  if (verbose) process.stderr.write(`  [START] ${task.id}\n`);
  const tmpDir = await createTempGitRepo();
  if (verbose) process.stderr.write(`  [REPO] ${task.id} -> ${tmpDir}\n`);
  const controller = createSubAgentController();
  const stub = new ToolCallingStubLLM(buildStubTurns(task));
  const ac = new AbortController();

  const startedAt = Date.now();

  try {
    const result = await Promise.race([
      runSalmonLoop({
        instruction: `Dispatch a ${task.profile} sub-agent to: ${task.task}`,
        repoPath: tmpDir,
        llm: stub as unknown as LLM,
        mode: 'patch',
        dryRun: true,
        subAgentController: controller,
        agentKind: 'primary',
        signal: ac.signal,
        llmFactory: () => new ToolCallingStubLLM(buildSubAgentStubTurns(task)) as unknown as LLM,
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          ac.abort();
          reject(new Error('Task timeout'));
        }, TASK_TIMEOUT_MS);
        // Prevent timer from keeping the process alive
        timer.unref();
      }),
    ]);

    const agents = controller.listAgents();
    const totalAgentToolCalls = agents.reduce((sum, a) => sum + a.toolCallCount, 0);
    const totalAgentTokenUsage = agents.reduce((sum, a) => sum + a.tokenUsage, 0);

    const evalResult: EvalResult = {
      taskId: task.id,
      profile: task.profile,
      dispatchMode: task.dispatchMode,
      complexity: task.complexity,
      success: result.success,
      reasonCode: result.reasonCode,
      attempts: result.attempts,
      tokenUsage: result.usage,
      agentCount: agents.length,
      agentToolCalls: totalAgentToolCalls,
      agentTokenUsage: totalAgentTokenUsage,
      durationMs: Date.now() - startedAt,
    };

    if (verbose) {
      const status = result.success ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${task.id} — ${result.reasonCode} (${evalResult.durationMs}ms, ${agents.length} agents)`);
      if (!result.success) {
        console.log(`    reason: ${result.reason?.slice(0, 200)}`);
        if (result.history) {
          for (const h of result.history) {
            console.log(`    attempt ${h.attempt}: error=${h.error?.slice(0, 150) ?? 'none'}`);
          }
        }
      }
    }

    return evalResult;
  } catch (error) {
    const evalResult: EvalResult = {
      taskId: task.id,
      profile: task.profile,
      dispatchMode: task.dispatchMode,
      complexity: task.complexity,
      success: false,
      reasonCode: 'LOOP_CRASH',
      attempts: 0,
      agentCount: 0,
      agentToolCalls: 0,
      agentTokenUsage: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };

    if (verbose) {
      console.log(`  [CRASH] ${task.id} — ${evalResult.error}`);
    }

    return evalResult;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function buildReport(results: EvalResult[]): EvalReport {
  const completed = results.filter((r) => r.success).length;
  const failed = results.length - completed;

  const byProfile: Record<string, { total: number; success: number; failed: number }> = {};
  const byComplexity: Record<string, { total: number; success: number; failed: number }> = {};

  for (const r of results) {
    byProfile[r.profile] ??= { total: 0, success: 0, failed: 0 };
    byProfile[r.profile].total++;
    if (r.success) byProfile[r.profile].success++;
    else byProfile[r.profile].failed++;

    byComplexity[r.complexity] ??= { total: 0, success: 0, failed: 0 };
    byComplexity[r.complexity].total++;
    if (r.success) byComplexity[r.complexity].success++;
    else byComplexity[r.complexity].failed++;
  }

  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const totalTokens = results.reduce((s, r) => s + (r.tokenUsage?.totalTokens ?? 0), 0);

  return {
    totalTasks: results.length,
    completedTasks: completed,
    failedTasks: failed,
    successRate: results.length > 0 ? completed / results.length : 0,
    avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    avgTokenUsage: results.length > 0 ? totalTokens / results.length : 0,
    byProfile,
    byComplexity,
    results,
  };
}

function printReport(report: EvalReport): void {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Sub-Agent Evaluation Report');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Total:      ${report.totalTasks}`);
  console.log(`  Completed:  ${report.completedTasks}`);
  console.log(`  Failed:     ${report.failedTasks}`);
  console.log(`  Success:    ${(report.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg time:   ${report.avgDurationMs.toFixed(0)}ms`);
  console.log(`  Avg tokens: ${report.avgTokenUsage.toFixed(0)}`);
  console.log('');

  console.log('  By Profile:');
  for (const [profile, stats] of Object.entries(report.byProfile)) {
    console.log(`    ${profile.padEnd(12)} ${stats.success}/${stats.total} passed`);
  }

  console.log('\n  By Complexity:');
  for (const [complexity, stats] of Object.entries(report.byComplexity)) {
    console.log(`    ${complexity.padEnd(12)} ${stats.success}/${stats.total} passed`);
  }

  const crashes = report.results.filter((r) => r.error);
  if (crashes.length > 0) {
    console.log('\n  Crashes:');
    for (const r of crashes) {
      console.log(`    ${r.taskId}: ${r.error}`);
    }
  }

  console.log('═══════════════════════════════════════════════\n');
}

// ─── Main ───

async function main(): Promise<void> {
  process.stderr.write('[eval] starting initialization...\n');
  // Initialize runtime singletons (same as tests/setup-bun.ts)
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
  const filter = args.find((a) => a.startsWith('--filter='))?.split('=')[1];
  const verbose = args.includes('--verbose');

  if (mode === 'real') {
    console.error('Real LLM mode not yet implemented. Use --mode=stub.');
    process.exit(1);
  }

  // Load tasks
  const { readFile } = await import('fs/promises');
  const scriptDir = typeof import.meta.dir !== 'undefined'
    ? import.meta.dir
    : path.dirname(new URL(import.meta.url).pathname);
  const tasksPath = path.join(scriptDir, 'sub-agent-eval-tasks.json');
  const tasks: TaskDefinition[] = JSON.parse(await readFile(tasksPath, 'utf-8'));

  // Filter tasks
  const filtered = filter
    ? tasks.filter((t) => t.tags.includes(filter) || t.profile === filter || t.complexity === filter)
    : tasks;

  process.stderr.write(`[eval] running ${filtered.length} tasks (mode=${mode})\n`);
  console.log(`Running ${filtered.length} evaluation tasks (mode=${mode})...\n`);

  const results: EvalResult[] = [];
  for (const task of filtered) {
    results.push(await runCase(task, verbose));
  }

  const report = buildReport(results);
  printReport(report);

  // Write JSON report
  const reportPath = path.join(scriptDir, 'sub-agent-eval-report.json');
  const { writeFile } = await import('fs/promises');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${reportPath}`);

  // Exit with non-zero if any tasks failed
  if (report.failedTasks > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
