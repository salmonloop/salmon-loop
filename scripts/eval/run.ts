/**
 * Shared evaluation harness.
 *
 * Loads tasks, runs them through a provider, collects results, and writes reports.
 * All eval CLI scripts delegate to this.
 */

import { writeFile } from 'fs/promises';

import type { EvalProvider, EvalReport, EvalResult, EvalRunOptions, EvalTaskDefinition } from './types.js';

// ─── Run Harness ───

export interface RunHarnessOptions {
  provider: EvalProvider;
  tasksSource: string;
  runOptions: EvalRunOptions;
  reportPath?: string;
  rateLimitMs?: number;
}

export async function runHarness(options: RunHarnessOptions): Promise<EvalReport> {
  const { provider, tasksSource, runOptions, reportPath, rateLimitMs } = options;

  // Load tasks
  const allTasks = await provider.loadTasks(tasksSource);

  // Apply filter
  const tasks = runOptions.filter
    ? allTasks.filter(runOptions.filter)
    : allTasks;

  process.stderr.write(`[eval] running ${tasks.length} tasks (provider=${provider.name}, mode=${runOptions.mode ?? 'stub'})\n`);
  console.log(`Running ${tasks.length} evaluation tasks (provider=${provider.name}, mode=${runOptions.mode ?? 'stub'})...\n`);

  // Run tasks sequentially
  const results: EvalResult[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (i > 0 && rateLimitMs && rateLimitMs > 0) {
      await new Promise((r) => setTimeout(r, rateLimitMs));
    }

    const task = tasks[i];
    const result = await provider.runTask(task, runOptions);
    results.push(result);
  }

  // Build report
  const completed = results.filter((r) => r.success).length;
  const failed = results.length - completed;
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);

  const report: EvalReport = {
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    totalTasks: results.length,
    completedTasks: completed,
    failedTasks: failed,
    successRate: results.length > 0 ? completed / results.length : 0,
    avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    results,
    supplement: provider.buildSupplement?.(results),
  };

  // Print report
  printReport(report);

  // Write JSON report
  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report written to ${reportPath}`);
  }

  return report;
}

// ─── Report Printer ───

export function printReport(report: EvalReport): void {
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ${report.provider} Evaluation Report`);
  console.log('═══════════════════════════════════════════════');
  console.log(`  Total:      ${report.totalTasks}`);
  console.log(`  Completed:  ${report.completedTasks}`);
  console.log(`  Failed:     ${report.failedTasks}`);
  console.log(`  Success:    ${(report.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg time:   ${report.avgDurationMs.toFixed(0)}ms`);
  console.log('');

  // Print supplement sections (byProfile, byComplexity, etc.)
  if (report.supplement) {
    for (const [key, value] of Object.entries(report.supplement)) {
      if (typeof value === 'object' && value !== null) {
        const title = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
        console.log(`  ${title}:`);
        for (const [label, stats] of Object.entries(value)) {
          if (typeof stats === 'object' && stats !== null && 'total' in stats) {
            const s = stats as { total: number; success: number; failed: number };
            console.log(`    ${label.padEnd(12)} ${s.success}/${s.total} passed`);
          }
        }
        console.log('');
      }
    }
  }

  // Print crashes
  const crashes = report.results.filter((r) => r.error);
  if (crashes.length > 0) {
    console.log('  Crashes:');
    for (const r of crashes) {
      console.log(`    ${r.taskId}: ${r.error}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════\n');
}

// ─── Filter Builder ───

export function buildFilter(filterArg?: string): ((task: EvalTaskDefinition) => boolean) | undefined {
  if (!filterArg) return undefined;
  return (task) => {
    const meta = task.providerMeta;
    return (
      task.tags?.includes(filterArg) === true ||
      (meta as Record<string, unknown>)?.profile === filterArg ||
      (meta as Record<string, unknown>)?.complexity === filterArg
    );
  };
}
