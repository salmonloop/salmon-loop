/**
 * Harbor Evaluation Harness
 *
 * Runs evaluation tasks through Harbor (harbor-framework/harbor) CLI.
 * Supports Harbor datasets, local tasks, and JSON task definitions.
 *
 * Prerequisites:
 *   pip install harbor
 *   docker (for local environment)
 *   ANTHROPIC_API_KEY (or other agent API key)
 *
 * Usage:
 *   # Run a Harbor dataset
 *   npx tsx scripts/harbor-evaluation.ts --dataset terminal-bench@2.0 --agent claude-code --model anthropic/claude-opus-4-6
 *
 *   # Run a local task directory
 *   npx tsx scripts/harbor-evaluation.ts --task-path ./my-task --agent claude-code
 *
 *   # Run with custom settings
 *   npx tsx scripts/harbor-evaluation.ts --dataset swe-bench@1.0 --agent claude-code --n-concurrent 8 --env daytona
 */

import { runHarness, buildFilter } from './eval/run.js';
import { createHarborProvider } from './eval/providers/harbor.js';

function parseArgs(argv: string[]) {
  const args: Record<string, string | string[] | boolean> = {
    extraArgs: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--dataset' || token === '-d') { args.dataset = next; i++; continue; }
    if (token === '--task-path' || token === '-p') { args.taskPath = next; i++; continue; }
    if (token === '--tasks') { args.tasks = next; i++; continue; }
    if (token === '--agent' || token === '-a') { args.agent = next; i++; continue; }
    if (token === '--model' || token === '-m') { args.model = next; i++; continue; }
    if (token === '--n-concurrent' || token === '-n') { args.nConcurrent = next; i++; continue; }
    if (token === '--env' || token === '-e') { args.env = next; i++; continue; }
    if (token === '--jobs-dir' || token === '-o') { args.jobsDir = next; i++; continue; }
    if (token === '--filter') { args.filter = next; i++; continue; }
    if (token === '--report') { args.report = next; i++; continue; }
    if (token === '--verbose' || token === '-v') { args.verbose = true; continue; }
    if (token === '--help' || token === '-h') { args.help = true; continue; }

    // Pass through to harbor
    (args.extraArgs as string[]).push(token);
  }

  return args;
}

function printHelp() {
  console.log(`
Harbor Evaluation Harness

Usage:
  npx tsx scripts/harbor-evaluation.ts [options]

Options:
  --dataset, -d <name@version>  Harbor dataset (e.g., terminal-bench@2.0)
  --task-path, -p <path>        Local task directory
  --tasks <path>                JSON file with task definitions
  --agent, -a <name>            Agent name (default: claude-code)
  --model, -m <name>            Model name
  --n-concurrent, -n <num>      Concurrent trials (default: 4)
  --env, -e <type>              Environment: docker, daytona, e2b, modal, etc.
  --jobs-dir, -o <path>         Jobs output directory (default: jobs)
  --filter <tag>                Filter tasks by tag
  --report <path>               Write JSON report to path
  --verbose, -v                 Verbose output
  --help, -h                    Show this help

Environment Variables:
  ANTHROPIC_API_KEY    Required for Claude Code agent
  DAYTONA_API_KEY      Required for Daytona environment

Examples:
  # Run Terminal-Bench 2.0 with Claude Code
  npx tsx scripts/harbor-evaluation.ts -d terminal-bench@2.0 -a claude-code -m anthropic/claude-opus-4-6

  # Run a local Harbor task
  npx tsx scripts/harbor-evaluation.ts -p ./my-task -a claude-code

  # Run with Daytona cloud environment
  npx tsx scripts/harbor-evaluation.ts -d swe-bench@1.0 -a claude-code -e daytona -n 100
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.dataset && !args.taskPath && !args.tasks) {
    console.error('Error: Specify --dataset, --task-path, or --tasks');
    console.error('Run with --help for usage information.');
    process.exit(1);
  }

  // If --tasks is provided, load from JSON file (like sub-agent-eval-tasks.json)
  const tasksSource = (args.tasks as string) ?? (args.taskPath as string) ?? (args.dataset as string);

  const provider = createHarborProvider({
    dataset: args.dataset as string | undefined,
    agent: (args.agent as string) ?? 'claude-code',
    model: args.model as string | undefined,
    nConcurrent: args.nConcurrent ? parseInt(args.nConcurrent as string, 10) : 4,
    jobsDir: (args.jobsDir as string) ?? 'jobs',
    extraArgs: args.extraArgs as string[],
    env: (args.env as string) ?? 'docker',
  });

  const report = await runHarness({
    provider,
    tasksSource,
    runOptions: {
      verbose: args.verbose === true,
      filter: buildFilter(args.filter as string | undefined),
    },
    reportPath: args.report as string | undefined,
  });

  if (report.failedTasks > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
