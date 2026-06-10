/**
 * Native Evaluation Runner
 *
 * Runs Harbor-format tasks using salmon-loop CLI natively on the host,
 * bypassing Docker. Useful for ARM64 hosts where QEMU x86_64 is broken.
 *
 * Usage:
 *   npx tsx scripts/native-eval.ts --tasks <path> [--filter <name>] [--verbose]
 */

import { readFile, readdir, mkdir, cp } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

interface HarborTask {
  id: string;
  instruction: string;
  taskDir: string;
  testFile: string;
  workspaceDir: string;
}

async function loadHarborTasks(baseDir: string): Promise<HarborTask[]> {
  // Try loading from JSON first
  const jsonPath = path.join(baseDir, 'programming-eval.json');
  try {
    const raw = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as { cases: Array<{ id: string; instruction: string }> };
    return parsed.cases.map((c) => ({
      id: c.id,
      instruction: c.instruction,
      taskDir: path.join(baseDir, c.id),
      testFile: path.join(baseDir, c.id, 'tests', 'test_outputs.py'),
      workspaceDir: path.join('/tmp/native-eval', c.id),
    }));
  } catch {
    // Fall back to Harbor directory format
  }

  const entries = await readdir(baseDir, { withFileTypes: true });
  const tasks: HarborTask[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskDir = path.join(baseDir, entry.name);
    const instructionPath = path.join(taskDir, 'instruction.md');
    const testPath = path.join(taskDir, 'tests', 'test_outputs.py');

    try {
      const instruction = (await readFile(instructionPath, 'utf-8')).trim();
      tasks.push({
        id: entry.name,
        instruction,
        taskDir,
        testFile: testPath,
        workspaceDir: path.join('/tmp/native-eval', entry.name),
      });
    } catch {
      // Skip directories without instruction.md
    }
  }

  return tasks;
}

async function setupWorkspace(task: HarborTask): Promise<void> {
  await mkdir(task.workspaceDir, { recursive: true });

  // Initialize git repo (required by salmon-loop)
  await execCommand('git', ['init'], { cwd: task.workspaceDir });
  await execCommand('git', ['config', 'user.email', 'eval@test'], { cwd: task.workspaceDir });
  await execCommand('git', ['config', 'user.name', 'Eval'], { cwd: task.workspaceDir });

  // Create initial commit so salmon-loop has a clean base
  await execCommand('bash', ['-c', 'touch .gitkeep && git add . && git commit -m "init" --allow-empty'], { cwd: task.workspaceDir });

  // Copy salmon-loop config (LLM credentials)
  const configDir = path.join(task.workspaceDir, '.salmonloop', 'config');
  await mkdir(configDir, { recursive: true });
  const srcConfig = path.join(process.cwd(), '.salmonloop', 'config', 'config.json');
  try {
    await cp(srcConfig, path.join(configDir, 'config.json'));
  } catch {
    // Config not found — may use env vars
  }

  // Copy environment files (skip Dockerfile)
  const envDir = path.join(task.taskDir, 'environment');
  try {
    const envEntries = await readdir(envDir, { withFileTypes: true });
    for (const entry of envEntries) {
      if (entry.name === 'Dockerfile') continue;
      const src = path.join(envDir, entry.name);
      const dest = path.join(task.workspaceDir, entry.name);
      await cp(src, dest, { recursive: true });
    }
  } catch {
    // No environment directory
  }
}

function execCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
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

    const timer = options?.timeoutMs
      ? setTimeout(() => { child.kill('SIGTERM'); }, options.timeoutMs)
      : null;

    child.on('close', (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.on('error', (err: Error) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });
  });
}

async function runSalmonLoop(task: HarborTask, verbose: boolean): Promise<boolean> {
  if (verbose) process.stderr.write(`  [RUN] ${task.id}\n`);

  const escapedInstruction = JSON.stringify(task.instruction);
  const configPath = path.join(process.cwd(), '.salmonloop', 'config', 'config.json');
  const result = await execCommand(
    'bun',
    [
      'src/cli/index.ts',
      'run',
      '--instruction', escapedInstruction,
      '-r', task.workspaceDir,
      '-v', 'echo ok',
      '--config', configPath,
      '--output-format', 'json',
    ],
    {
      cwd: process.cwd(),
      timeoutMs: 600_000,
    },
  );

  if (verbose) {
    const status = result.exitCode === 0 ? 'OK' : 'FAIL';
    process.stderr.write(`  [${status}] ${task.id} — exit=${result.exitCode}\n`);
    if (result.exitCode !== 0) {
      process.stderr.write(`    stderr: ${result.stderr.slice(0, 500)}\n`);
    }
  }

  return result.exitCode === 0;
}

async function runVerifier(task: HarborTask, verbose: boolean): Promise<boolean> {
  if (verbose) process.stderr.write(`  [VERIFY] ${task.id}\n`);

  // Copy test file to workspace
  const testDest = path.join(task.workspaceDir, 'test_outputs.py');
  await cp(task.testFile, testDest);

  if (verbose) process.stderr.write(`  [CWD] ${task.workspaceDir}\n`);

  const result = await execCommand(
    'python3',
    ['-m', 'pytest', 'test_outputs.py', '-v', '--tb=short'],
    { cwd: task.workspaceDir, timeoutMs: 300_000 },
  );

  if (verbose) {
    const status = result.exitCode === 0 ? 'PASS' : 'FAIL';
    process.stderr.write(`  [${status}] ${task.id} — exit=${result.exitCode}\n`);
    if (result.exitCode !== 0) {
      process.stderr.write(`    stdout: ${result.stdout.slice(0, 500)}\n`);
    }
  }

  return result.exitCode === 0;
}

// ─── CLI ───

interface CliArgs {
  tasksDir: string;
  verbose: boolean;
  taskFilter?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { tasksDir: '', verbose: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tasks' || argv[i] === '-t') { args.tasksDir = argv[++i]; continue; }
    if (argv[i] === '--filter' || argv[i] === '-f') { args.taskFilter = argv[++i]; continue; }
    if (argv[i] === '--verbose' || argv[i] === '-v') { args.verbose = true; continue; }
  }
  if (!args.tasksDir) {
    console.error('Usage: npx tsx scripts/native-eval.ts --tasks <path> [--verbose]');
    process.exit(1);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let tasks = await loadHarborTasks(args.tasksDir);

  if (args.taskFilter) {
    tasks = tasks.filter((t) => t.id.includes(args.taskFilter!));
  }

  if (tasks.length === 0) {
    console.error(`No tasks found in ${args.tasksDir}`);
    process.exit(1);
  }

  console.log(`Found ${tasks.length} task(s)\n`);

  const results: { id: string; agentOk: boolean; verifyOk: boolean }[] = [];

  for (const task of tasks) {
    console.log(`━━━ ${task.id} ━━━`);
    await setupWorkspace(task);

    const agentOk = await runSalmonLoop(task, args.verbose);
    const verifyOk = agentOk ? await runVerifier(task, args.verbose) : false;

    results.push({ id: task.id, agentOk, verifyOk });
    console.log(`  Agent: ${agentOk ? 'OK' : 'FAIL'} | Verify: ${verifyOk ? 'PASS' : 'FAIL'}\n`);
  }

  const passed = results.filter((r) => r.verifyOk).length;
  console.log(`\n━━━ Summary ━━━`);
  console.log(`${passed}/${results.length} passed`);
  for (const r of results) {
    console.log(`  [${r.verifyOk ? 'PASS' : 'FAIL'}] ${r.id}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
