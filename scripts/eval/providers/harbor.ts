/**
 * Harbor eval provider.
 *
 * Runs evaluations using Harbor CLI (harbor-framework/harbor).
 * Executes `harbor run` as a subprocess and parses JSON results from the jobs directory.
 *
 * Prerequisites:
 *   pip install harbor
 *   docker (for local environment)
 *   ANTHROPIC_API_KEY (or other agent API key)
 */

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

import type { EvalProvider, EvalResult, EvalRunOptions, EvalTaskDefinition } from '../types.js';

// ─── Harbor Trial Result (subset of Harbor's TrialResult model) ───

interface HarborVerifierResult {
  rewards?: Record<string, number>;
  passed?: boolean;
}

interface HarborExceptionInfo {
  exception_type: string;
  exception_message: string;
}

interface HarborAgentInfo {
  name: string;
  version: string;
  model_info?: { name: string; provider?: string };
}

interface HarborTrialResult {
  task_name: string;
  trial_name: string;
  agent_info: HarborAgentInfo;
  verifier_result?: HarborVerifierResult;
  exception_info?: HarborExceptionInfo;
  started_at?: string;
  finished_at?: string;
}

interface HarborJobResult {
  id: string;
  n_total_trials: number;
  stats: {
    n_completed_trials: number;
    n_errored_trials: number;
    n_running_trials: number;
    n_pending_trials: number;
    pass_at_k?: Record<number, number>;
  };
  trial_results: HarborTrialResult[];
}

// ─── Config ───

export interface HarborProviderConfig {
  /** Harbor dataset name@version or local path */
  dataset?: string;
  /** Agent name (default: claude-code) */
  agent?: string;
  /** Model name */
  model?: string;
  /** Number of concurrent trials */
  nConcurrent?: number;
  /** Jobs output directory */
  jobsDir?: string;
  /** Extra harbor run flags */
  extraArgs?: string[];
  /** Environment type (docker, daytona, etc.) */
  env?: string;
}

// ─── Helpers ───

async function execCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.on('error', reject);
  });
}

async function findLatestJobDir(jobsDir: string): Promise<string | null> {
  try {
    const entries = await readdir(jobsDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(jobsDir, e.name))
      .sort()
      .reverse();
    return dirs[0] ?? null;
  } catch {
    return null;
  }
}

async function loadJobResult(jobDir: string): Promise<HarborJobResult | null> {
  try {
    const resultPath = path.join(jobDir, 'result.json');
    const raw = await readFile(resultPath, 'utf-8');
    return JSON.parse(raw) as HarborJobResult;
  } catch {
    return null;
  }
}

// ─── Provider ───

export function createHarborProvider(config: HarborProviderConfig = {}): EvalProvider {
  const {
    dataset,
    agent = 'claude-code',
    model,
    nConcurrent = 4,
    jobsDir = 'jobs',
    extraArgs = [],
    env: envType = 'docker',
  } = config;

  return {
    name: 'harbor',

    async loadTasks(source: string): Promise<EvalTaskDefinition[]> {
      // Source can be:
      // 1. A Harbor dataset name (e.g., "terminal-bench@2.0")
      // 2. A local task directory path
      // 3. A JSON file with task definitions

      const sourceStat = await stat(source).catch(() => null);

      if (sourceStat?.isDirectory()) {
        // Local Harbor task directory — load task.toml and instruction.md
        const taskToml = await readFile(path.join(source, 'task.toml'), 'utf-8').catch(() => '');
        const instruction = await readFile(path.join(source, 'instruction.md'), 'utf-8').catch(() => '');

        return [{
          id: path.basename(source),
          instruction: instruction.trim(),
          providerMeta: {
            taskPath: source,
            taskToml,
          },
        }];
      }

      if (source.endsWith('.json')) {
        // JSON file with task definitions
        const raw = await readFile(source, 'utf-8');
        const tasks = JSON.parse(raw) as Array<{ id: string; instruction: string; [key: string]: unknown }>;
        return tasks.map((t) => ({
          id: t.id,
          instruction: t.instruction,
          providerMeta: t,
        }));
      }

      // Treat as Harbor dataset name — tasks will be discovered by Harbor CLI
      return [{
        id: source,
        instruction: '',  // Harbor provides the instructions
        providerMeta: { dataset: source },
      }];
    },

    async runTask(task, options: EvalRunOptions): Promise<EvalResult> {
      const verbose = options.verbose ?? false;
      const startedAt = Date.now();

      if (verbose) process.stderr.write(`  [START] ${task.id} (harbor)\n`);

      // Build harbor run command
      const args = ['run', '-y'];

      // Dataset or task path
      const taskPath = task.providerMeta?.taskPath as string | undefined;
      const taskDataset = (task.providerMeta?.dataset as string) ?? dataset;

      if (taskPath) {
        args.push('-p', taskPath);
      } else if (taskDataset) {
        args.push('-d', taskDataset);
      } else {
        return {
          taskId: task.id,
          provider: 'harbor',
          success: false,
          reasonCode: 'NO_DATASET',
          attempts: 0,
          durationMs: Date.now() - startedAt,
          error: 'No dataset or task path specified. Use --dataset or provide a local task directory.',
        };
      }

      // Agent and model
      args.push('-a', agent);
      if (model) args.push('-m', model);

      // Concurrency
      args.push('-n', String(nConcurrent));

      // Environment
      args.push('-e', envType);

      // Jobs directory
      args.push('-o', jobsDir);

      // Extra args
      args.push(...extraArgs);

      if (verbose) {
        process.stderr.write(`  [CMD] harbor ${args.join(' ')}\n`);
      }

      try {
        const result = await execCommand('harbor', args, {
          cwd: process.cwd(),
        });

        if (verbose) {
          process.stderr.write(`  [EXIT] ${result.exitCode}\n`);
        }

        // Find and parse the job result
        const jobDir = await findLatestJobDir(jobsDir);
        const jobResult = jobDir ? await loadJobResult(jobDir) : null;

        if (!jobResult) {
          // No result file — check if the command failed
          return {
            taskId: task.id,
            provider: 'harbor',
            success: false,
            reasonCode: 'NO_RESULT',
            attempts: 1,
            durationMs: Date.now() - startedAt,
            error: `Harbor exited with code ${result.exitCode}. No result file found.\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
          };
        }

        // Parse trial results
        const trials = jobResult.trial_results ?? [];
        const completed = jobResult.stats?.n_completed_trials ?? 0;
        const errored = jobResult.stats?.n_errored_trials ?? 0;
        const total = jobResult.n_total_trials ?? trials.length;

        // Determine success based on verifier rewards
        const passedTrials = trials.filter((t) => {
          if (t.verifier_result?.rewards) {
            return Object.values(t.verifier_result.rewards).some((v) => v > 0);
          }
          return false;
        });

        const success = passedTrials.length > 0 && errored === 0;
        const passRate = total > 0 ? passedTrials.length / total : 0;

        if (verbose) {
          const status = success ? 'PASS' : 'FAIL';
          console.log(`  [${status}] ${task.id} — ${passedTrials.length}/${total} passed (${Date.now() - startedAt}ms)`);
          if (errored > 0) {
            const errors = trials.filter((t) => t.exception_info);
            for (const t of errors) {
              console.log(`    error: ${t.task_name}: ${t.exception_info?.exception_message?.slice(0, 150)}`);
            }
          }
        }

        return {
          taskId: task.id,
          provider: 'harbor',
          success,
          reasonCode: success ? 'SUCCESS' : (errored > 0 ? 'HARBOR_ERROR' : 'VERIFIER_FAILED'),
          attempts: 1,
          durationMs: Date.now() - startedAt,
          providerMeta: {
            jobId: jobResult.id,
            totalTrials: total,
            completedTrials: completed,
            erroredTrials: errored,
            passedTrials: passedTrials.length,
            passRate,
            passAtK: jobResult.stats?.pass_at_k,
            agentName: trials[0]?.agent_info?.name,
            modelName: trials[0]?.agent_info?.model_info?.name,
          },
          error: success ? undefined : `${errored} errors, ${passedTrials.length}/${total} passed`,
        };
      } catch (error) {
        if (verbose) {
          console.log(`  [CRASH] ${task.id} — ${error instanceof Error ? error.message : String(error)}`);
        }

        return {
          taskId: task.id,
          provider: 'harbor',
          success: false,
          reasonCode: 'HARBOR_CRASH',
          attempts: 0,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    buildSupplement(results) {
      const totalTrials = results.reduce((s, r) => s + ((r.providerMeta?.totalTrials as number) ?? 0), 0);
      const passedTrials = results.reduce((s, r) => s + ((r.providerMeta?.passedTrials as number) ?? 0), 0);
      const erroredTrials = results.reduce((s, r) => s + ((r.providerMeta?.erroredTrials as number) ?? 0), 0);

      return {
        harbor: {
          totalTrials,
          passedTrials,
          erroredTrials,
          passRate: totalTrials > 0 ? passedTrials / totalTrials : 0,
        },
      };
    },
  };
}
