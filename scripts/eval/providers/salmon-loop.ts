/**
 * Salmon-Loop eval provider.
 *
 * Runs sub-agent dispatch tasks through the real runSalmonLoop pipeline.
 * Extracted from scripts/sub-agent-evaluation.ts.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { resolveConfig } from '../../../src/core/config/resolve.js';
import { createRuntimeLlm } from '../../../src/core/llm/factory.js';
import { ToolCallingStubLLM, type StubTurn } from '../../../src/core/llm/tool-calling-stub.js';
import { runSalmonLoop } from '../../../src/core/runtime/loop.js';
import { createSubAgentController } from '../../../src/core/sub-agent/controller.js';
import type { LLM } from '../../../src/core/types/llm.js';
import type { EvalProvider, EvalResult, EvalRunOptions, EvalTaskDefinition } from '../types.js';

// ─── Internal Task Definition (superset of EvalTaskDefinition) ───

interface SalmonTaskMeta {
  profile: string;
  sessionTarget: 'isolated' | 'shared' | 'fork';
  dispatchMode: 'sync' | 'async' | 'fire-and-forget';
  complexity: 'simple' | 'medium' | 'complex';
  mode: 'patch' | 'review';
}

// ─── Helpers ───

async function execCommand(cwd: string, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'ignore' });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
    child.on('error', reject);
  });
}

async function createTempGitRepo(retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const dir = await mkdtemp(path.join(tmpdir(), 'sub-agent-eval-'));
      await execCommand(dir, 'git', ['init']);
      await execCommand(dir, 'git', ['config', 'user.email', 'eval@test']);
      await execCommand(dir, 'git', ['config', 'user.name', 'Eval']);
      await writeFile(path.join(dir, 'README.md'), '# Eval Repo\n');
      await writeFile(path.join(dir, '.gitignore'), '.salmonloop/\n');
      await execCommand(dir, 'git', ['add', '.']);
      await execCommand(dir, 'git', ['commit', '-m', 'init']);
      return dir;
    } catch (error) {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to create temp git repo after retries');
}

// ─── Stub Builders ───

function buildValidDiff(profile: string): string {
  return `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Eval Repo
+Updated by ${profile} sub-agent
`;
}

function buildSubAgentStubTurns(task: EvalTaskDefinition, meta: SalmonTaskMeta): StubTurn[] {
  const planJson = JSON.stringify({
    goal: `Complete: ${task.instruction}`,
    files: ['README.md'],
    changes: [`Executed ${meta.profile} task`],
    verify: 'echo ok',
  });

  const needsPatch = meta.profile === 'surgeon' || meta.profile === 'cleaner';

  return [
    { content: planJson },
    ...(needsPatch ? [{ content: buildValidDiff(meta.profile) }] : []),
    { content: 'ok' },
    { content: 'ok' },
  ];
}

function buildSingleAttemptTurns(task: EvalTaskDefinition, meta: SalmonTaskMeta): StubTurn[] {
  const dispatchArgs = {
    agent_ref: meta.profile,
    task: task.instruction,
    session_target: meta.sessionTarget,
    expected_output:
      meta.profile === 'surgeon' || meta.profile === 'cleaner'
        ? 'patch'
        : meta.profile === 'reviewer'
          ? 'review'
          : 'diagnosis',
    ...(meta.dispatchMode === 'async' ? { async: true } : {}),
  };

  const dispatchCallId = `call-dispatch-${randomUUID().slice(0, 8)}`;

  const planJson = JSON.stringify({
    goal: `Complete: ${task.instruction}`,
    files: ['README.md'],
    changes: [`Dispatched ${meta.profile} sub-agent`],
    verify: 'echo ok',
  });

  const awaitCallId = `call-await-${randomUUID().slice(0, 8)}`;

  return [
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
    {
      content: `Dispatching ${meta.profile} sub-agent.`,
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
    ...(meta.dispatchMode === 'async'
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
    { content: planJson },
    { content: buildValidDiff(meta.profile) },
  ];
}

function buildStubTurns(task: EvalTaskDefinition, meta: SalmonTaskMeta): StubTurn[] {
  const allTurns: StubTurn[] = [];
  for (let i = 0; i < 3; i++) {
    allTurns.push(...buildSingleAttemptTurns(task, meta));
  }
  return allTurns;
}

// ─── Constants ───

const TASK_TIMEOUT_MS = 10_000;
const TASK_TIMEOUT_REAL_MS = 600_000;

// ─── Real LLM Config ───

export interface RealLlmConfig {
  llm: LLM;
  llmFactory: (modelId: string) => LLM | undefined;
}

export async function resolveRealLlm(): Promise<RealLlmConfig> {
  const repoRoot = process.cwd();
  const config = await resolveConfig({ repoRoot });
  const resolved = config.llm;
  const { llm, warnings } = createRuntimeLlm(resolved);
  if (warnings.includes('API_KEY_MISSING')) {
    throw new Error('No API key found. Set SALMONLOOP_API_KEY or S8P_API_KEY.');
  }
  const factory = () => llm;
  return { llm, llmFactory: factory };
}

// ─── Provider ───

export function createSalmonLoopProvider(realLlm?: RealLlmConfig): EvalProvider {
  return {
    name: 'salmon-loop',

    async loadTasks(source: string): Promise<EvalTaskDefinition[]> {
      const raw = await readFile(source, 'utf-8');
      const tasks = JSON.parse(raw) as Array<{
        id: string;
        profile: string;
        sessionTarget: 'isolated' | 'shared' | 'fork';
        dispatchMode: 'sync' | 'async' | 'fire-and-forget';
        complexity: 'simple' | 'medium' | 'complex';
        task: string;
        mode: 'patch' | 'review';
        tags: string[];
      }>;

      return tasks.map((t) => ({
        id: t.id,
        instruction: t.task,
        tags: t.tags,
        providerMeta: {
          profile: t.profile,
          sessionTarget: t.sessionTarget,
          dispatchMode: t.dispatchMode,
          complexity: t.complexity,
          mode: t.mode,
        } satisfies SalmonTaskMeta,
      }));
    },

    async runTask(task, options): Promise<EvalResult> {
      const meta = task.providerMeta as unknown as SalmonTaskMeta;
      const verbose = options.verbose ?? false;
      const startedAt = Date.now();

      if (verbose) process.stderr.write(`  [START] ${task.id}\n`);
      const tmpDir = await createTempGitRepo();
      if (verbose) process.stderr.write(`  [REPO] ${task.id} -> ${tmpDir}\n`);
      const controller = createSubAgentController();
      const ac = new AbortController();
      const timeoutMs = realLlm ? TASK_TIMEOUT_REAL_MS : (task.timeoutMs ?? TASK_TIMEOUT_MS);

      try {
        const llm = realLlm
          ? realLlm.llm
          : (new ToolCallingStubLLM(buildStubTurns(task, meta)) as unknown as LLM);
        const llmFactory = realLlm
          ? realLlm.llmFactory
          : () => new ToolCallingStubLLM(buildSubAgentStubTurns(task, meta)) as unknown as LLM;

        const result = await Promise.race([
          runSalmonLoop({
            instruction: `Dispatch a ${meta.profile} sub-agent to: ${task.instruction}`,
            repoPath: tmpDir,
            llm,
            mode: meta.mode,
            dryRun: realLlm ? false : true,
            subAgentController: controller,
            agentKind: 'primary',
            signal: ac.signal,
            llmFactory,
          }),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
              ac.abort();
              reject(new Error('Task timeout'));
            }, timeoutMs);
            timer.unref();
          }),
        ]);

        const agents = controller.listAgents();
        const totalAgentToolCalls = agents.reduce((sum, a) => sum + a.toolCallCount, 0);
        const totalAgentTokenUsage = agents.reduce((sum, a) => sum + a.tokenUsage, 0);

        const evalResult: EvalResult = {
          taskId: task.id,
          provider: 'salmon-loop',
          success: result.success,
          reasonCode: result.reasonCode,
          attempts: result.attempts,
          tokenUsage: result.usage,
          durationMs: Date.now() - startedAt,
          providerMeta: {
            profile: meta.profile,
            dispatchMode: meta.dispatchMode,
            complexity: meta.complexity,
            agentCount: agents.length,
            agentToolCalls: totalAgentToolCalls,
            agentTokenUsage: totalAgentTokenUsage,
          },
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
          provider: 'salmon-loop',
          success: false,
          reasonCode: 'LOOP_CRASH',
          attempts: 0,
          durationMs: Date.now() - startedAt,
          providerMeta: { profile: meta.profile, dispatchMode: meta.dispatchMode, complexity: meta.complexity },
          error: error instanceof Error ? error.message : String(error),
        };

        if (verbose) {
          console.log(`  [CRASH] ${task.id} — ${evalResult.error}`);
        }

        return evalResult;
      } finally {
        await rm(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      }
    },

    buildSupplement(results) {
      const byProfile: Record<string, { total: number; success: number; failed: number }> = {};
      const byComplexity: Record<string, { total: number; success: number; failed: number }> = {};

      for (const r of results) {
        const meta = r.providerMeta as SalmonTaskMeta | undefined;
        const profile = meta?.profile ?? 'unknown';
        const complexity = meta?.complexity ?? 'unknown';

        byProfile[profile] ??= { total: 0, success: 0, failed: 0 };
        byProfile[profile].total++;
        if (r.success) byProfile[profile].success++;
        else byProfile[profile].failed++;

        byComplexity[complexity] ??= { total: 0, success: 0, failed: 0 };
        byComplexity[complexity].total++;
        if (r.success) byComplexity[complexity].success++;
        else byComplexity[complexity].failed++;
      }

      return { byProfile, byComplexity };
    },
  };
}
