/**
 * Evaluation Runner
 *
 * Spawns CLI subprocesses per evaluation case and collects audit artifacts.
 * Delegates to the shared eval harness with the subprocess provider.
 *
 * Usage:
 *   npx tsx scripts/evaluation-runner.ts --repo <path> --config <path> --cases <path> --out <path> [options]
 */

import { createSubprocessProvider } from './eval/providers/subprocess.js';
import { runHarness } from './eval/run.js';

export { buildRunCommandArgs, detectNewestAuditArtifact } from './eval/providers/subprocess.js';

// ─── CLI ───

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }
  return value;
}

function parseCliArgs(argv: string[]) {
  const options: Record<string, string | undefined> = {
    verifyCommand: 'node -e "process.exit(0)"',
    checkpointStrategy: 'worktree',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--repo') { options.repoPath = next; index += 1; continue; }
    if (token === '--config') { options.configPath = next; index += 1; continue; }
    if (token === '--cases') { options.casesPath = next; index += 1; continue; }
    if (token === '--out') { options.outputDir = next; index += 1; continue; }
    if (token === '--verify') { options.verifyCommand = next; index += 1; continue; }
    if (token === '--checkpoint-strategy') { options.checkpointStrategy = next; index += 1; continue; }
    if (token === '--worktree-prepare') { options.worktreePrepare = next; index += 1; continue; }
  }

  return {
    repoPath: assertString(options.repoPath, '--repo'),
    configPath: assertString(options.configPath, '--config'),
    casesPath: assertString(options.casesPath, '--cases'),
    outputDir: assertString(options.outputDir, '--out'),
    verifyCommand: options.verifyCommand!,
    checkpointStrategy: options.checkpointStrategy!,
    worktreePrepare: options.worktreePrepare,
  };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  const provider = createSubprocessProvider({
    repoPath: options.repoPath,
    configPath: options.configPath,
    outputDir: options.outputDir,
    verifyCommand: options.verifyCommand,
    checkpointStrategy: options.checkpointStrategy,
    worktreePrepare: options.worktreePrepare,
  });

  const report = await runHarness({
    provider,
    tasksSource: options.casesPath,
    runOptions: { verbose: true },
    reportPath: `${options.outputDir}/summary.json`,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
