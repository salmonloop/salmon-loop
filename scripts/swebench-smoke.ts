import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { buildBenchmarkPatchArtifact } from '../src/core/benchmark/patch-artifact.js';
import type { SweBenchInstance, SweBenchPrediction } from '../src/core/benchmark/swe-bench.js';

type SmokeKind = 'deterministic-contract' | 'real-llm-smoke' | 'benchmark-submit';
type GateStatus = 'pass' | 'fail' | 'skip';

export interface CommandResult {
  command: string;
  args?: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface GateResult {
  status: GateStatus;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OverlaySpec {
  files?: Array<{ path: string; content: string }>;
  behaviorCommand?: string;
  regressionCommand?: string;
}

export interface SmokeReport {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  smokeKind: SmokeKind;
  workspace: {
    outputDir: string;
    repoDir: string;
    kept: boolean;
  };
  instance: {
    instanceId: string;
    repo?: string;
    baseCommit?: string;
  };
  commands: {
    verifyCommand: string;
    behaviorCommand?: string;
    regressionCommand?: string;
  };
  flow: {
    exitCode: number;
    success: boolean;
    reasonCode?: string;
    diagnosticCode?: string;
  };
  artifacts: {
    patchPath: string;
    predictionsPath: string;
    stdoutPath: string;
    stderrPath: string;
    reportPath: string;
    patchSha256: string;
    patchBytes: number;
    changedFiles: string[];
  };
  gates: {
    overlay: GateResult;
    reproduction: GateResult;
    verifyStrength: GateResult;
    patchNonEmpty: GateResult;
    predictionParse: GateResult;
    predictionPatch: GateResult;
    gitDiffCheck: GateResult;
    gitApplyCheck: GateResult;
    behavior: GateResult;
    regression: GateResult;
    submission: GateResult;
  };
  quality: {
    flowSuccess: boolean;
    reproductionPrepared: boolean;
    patchApplyable: boolean;
    behaviorVerified: boolean;
    regressionVerified: boolean;
    submitted: boolean;
    resolved?: boolean;
    passedLocalQualityBar: boolean;
  };
}

interface CliOptions {
  sourceRepo?: string;
  instanceFile?: string;
  subset: string;
  split: string;
  index?: number;
  instanceId?: string;
  config?: string;
  out?: string;
  cleanup: boolean;
  submit: boolean;
  sbCli: string;
  apiKeyEnv: string;
  timeoutMs: number;
  modelName: string;
  verify?: string;
  behaviorCommand?: string;
  regressionCommand?: string;
  overlay?: string;
  actMode: string;
  checkpointStrategy: string;
  pythonLoader: string;
}

interface RunSubmitOptions extends CliOptions {
  submit: true;
}

const PROJECT_ROOT = path.resolve(process.cwd());
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

function isTruthyWeakVerify(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized === 'true' || normalized === ':' || normalized === 'echo ok';
}

function normalizePatchText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  return normalized.length > 0 ? `${normalized}\n` : '';
}

function checkBenchmarkPatch(patch: string): GateResult {
  const normalized = normalizePatchText(patch);
  if (!normalized) {
    return fail('PREDICTION_PATCH_EMPTY', 'SWE-bench model_patch is empty.');
  }
  if (!normalized.includes('\ndiff --git ') && !normalized.startsWith('diff --git ')) {
    return fail(
      'PREDICTION_PATCH_NOT_GIT_DIFF',
      'SWE-bench model_patch must be a git unified diff.',
    );
  }
  if (normalized.includes('```')) {
    return fail(
      'PREDICTION_PATCH_FENCED',
      'SWE-bench model_patch must not include markdown fences.',
    );
  }
  return pass('PREDICTION_PATCH_OK', 'SWE-bench model_patch is a non-empty git diff.', {
    bytes: Buffer.byteLength(normalized, 'utf-8'),
  });
}

function normalizeRelativePath(candidate: string): string {
  const normalized = candidate.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    !normalized ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.isAbsolute(candidate) ||
    normalized === '.git' ||
    normalized.startsWith('.git/')
  ) {
    throw new Error(`Unsafe overlay path: ${candidate}`);
  }
  return normalized;
}

function pass(code: string, message: string, details?: Record<string, unknown>): GateResult {
  return { status: 'pass', code, message, details };
}

function fail(code: string, message: string, details?: Record<string, unknown>): GateResult {
  return { status: 'fail', code, message, details };
}

function skip(code: string, message: string, details?: Record<string, unknown>): GateResult {
  return { status: 'skip', code, message, details };
}

export function classifyVerifyStrength(command: string): GateResult {
  if (isTruthyWeakVerify(command)) {
    return fail(
      'WEAK_VERIFY_COMMAND',
      '`verify` is only a flow smoke gate; it does not prove behavior correctness.',
      { command },
    );
  }
  return pass('VERIFY_COMMAND_PRESENT', 'Verification command is non-trivial.', { command });
}

function classifyReproductionCommand(command?: string): GateResult {
  if (!command) {
    return fail(
      'REPRODUCTION_COMMAND_MISSING',
      'No reproduction command was provided; benchmark behavior cannot be evaluated.',
    );
  }
  if (isTruthyWeakVerify(command)) {
    return fail(
      'REPRODUCTION_COMMAND_WEAK',
      'Reproduction command must exercise the reported problem behavior.',
      { command },
    );
  }
  return pass('REPRODUCTION_COMMAND_PRESENT', 'Reproduction command is present.', { command });
}

export function deriveSmokeKind(params: {
  submit: boolean;
  warnings?: unknown;
  requested?: SmokeKind;
}): SmokeKind {
  if (params.requested) return params.requested;
  if (params.submit) return 'benchmark-submit';
  const warnings = Array.isArray(params.warnings) ? params.warnings : [];
  const usedStub = warnings.some((warning) => {
    if (!warning || typeof warning !== 'object') return false;
    const code = (warning as { code?: unknown }).code;
    return code === 'LLM_CREDENTIAL_MISSING';
  });
  return usedStub ? 'deterministic-contract' : 'real-llm-smoke';
}

export function buildQualitySummary(params: {
  flowSuccess: boolean;
  gates: SmokeReport['gates'];
  resolved?: boolean;
}): SmokeReport['quality'] {
  const reproductionPrepared =
    params.gates.overlay.status !== 'fail' && params.gates.reproduction.status === 'pass';
  const patchApplyable =
    params.gates.patchNonEmpty.status === 'pass' &&
    params.gates.predictionParse.status === 'pass' &&
    params.gates.predictionPatch.status === 'pass' &&
    params.gates.gitDiffCheck.status === 'pass' &&
    params.gates.gitApplyCheck.status === 'pass';
  const behaviorVerified =
    params.gates.verifyStrength.status === 'pass' && params.gates.behavior.status === 'pass';
  const regressionVerified = params.gates.regression.status === 'pass';
  const submitted = params.gates.submission.status === 'pass';

  return {
    flowSuccess: params.flowSuccess,
    reproductionPrepared,
    patchApplyable,
    behaviorVerified,
    regressionVerified,
    submitted,
    resolved: params.resolved,
    passedLocalQualityBar:
      params.flowSuccess &&
      reproductionPrepared &&
      patchApplyable &&
      behaviorVerified &&
      regressionVerified,
  };
}

export function resolveSmokeExitCode(params: {
  quality: SmokeReport['quality'];
  submit: boolean;
}): number {
  if (!params.quality.passedLocalQualityBar) return 1;
  if (!params.submit) return 0;
  return params.quality.submitted && params.quality.resolved === true ? 0 : 1;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    subset: 'lite',
    split: 'dev',
    cleanup: false,
    submit: false,
    sbCli: 'sb-cli',
    apiKeyEnv: 'SWEBENCH_API_KEY',
    timeoutMs: 30 * 60 * 1000,
    modelName: 'salmon-loop-swebench-smoke',
    actMode: 'patch',
    checkpointStrategy: 'direct',
    pythonLoader: 'uv',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--source-repo') {
      options.sourceRepo = next;
      index += 1;
    } else if (token === '--instance-file') {
      options.instanceFile = next;
      index += 1;
    } else if (token === '--subset') {
      options.subset = next;
      index += 1;
    } else if (token === '--split') {
      options.split = next;
      index += 1;
    } else if (token === '--index') {
      options.index = Number(next);
      index += 1;
    } else if (token === '--instance-id') {
      options.instanceId = next;
      index += 1;
    } else if (token === '--config') {
      options.config = next;
      index += 1;
    } else if (token === '--out') {
      options.out = next;
      index += 1;
    } else if (token === '--timeout-ms') {
      options.timeoutMs = Number(next);
      index += 1;
    } else if (token === '--model-name') {
      options.modelName = next;
      index += 1;
    } else if (token === '--verify') {
      options.verify = next;
      index += 1;
    } else if (token === '--behavior-command') {
      options.behaviorCommand = next;
      index += 1;
    } else if (token === '--regression-command') {
      options.regressionCommand = next;
      index += 1;
    } else if (token === '--overlay') {
      options.overlay = next;
      index += 1;
    } else if (token === '--act-mode') {
      options.actMode = next;
      index += 1;
    } else if (token === '--checkpoint-strategy') {
      options.checkpointStrategy = next;
      index += 1;
    } else if (token === '--sb-cli') {
      options.sbCli = next;
      index += 1;
    } else if (token === '--api-key-env') {
      options.apiKeyEnv = next;
      index += 1;
    } else if (token === '--python-loader') {
      options.pythonLoader = next;
      index += 1;
    } else if (token === '--submit') {
      options.submit = true;
    } else if (token === '--cleanup') {
      options.cleanup = true;
    } else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }
  if (options.index !== undefined && (!Number.isInteger(options.index) || options.index < 0)) {
    throw new Error('--index must be a non-negative integer.');
  }
  if (options.cleanup && options.out) {
    throw new Error('--cleanup cannot be combined with --out.');
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`Usage: bun scripts/swebench-smoke.ts [options]

Runs SalmonLoop against one SWE-bench style instance and writes a machine-readable report.

Input:
  --instance-file <path>       Local SWE-bench instance JSON. Preferred for deterministic runs.
  --subset <name>              Dataset subset when no instance file is provided. Default: lite.
  --split <name>               Dataset split. Default: dev.
  --index <n>                  Dataset row index.
  --instance-id <id>           Dataset instance id.
  --source-repo <path>         Local repository to fetch instead of GitHub. Useful for deterministic harness tests.

Run:
  --config <path>              SalmonLoop config path.
  --out <dir>                  Output directory. Defaults to a temp directory.
  --verify <command>           Verification command. Defaults to overlay behavior command or true.
  --behavior-command <cmd>     Reproduction command. Required for behavior_verified=true.
  --regression-command <cmd>   PASS_TO_PASS/local regression command.
  --overlay <path>             JSON overlay with files and optional commands.
  --submit                     Submit via sb-cli after local gates.
  --cleanup                    Delete the temporary output directory after printing report JSON.
`);
}

function datasetName(subset: string): string {
  const mapping: Record<string, string> = {
    full: 'princeton-nlp/SWE-Bench',
    verified: 'princeton-nlp/SWE-Bench_Verified',
    lite: 'princeton-nlp/SWE-Bench_Lite',
    multimodal: 'princeton-nlp/SWE-Bench_Multimodal',
    multilingual: 'swe-bench/SWE-Bench_Multilingual',
  };
  return mapping[subset] ?? subset;
}

async function runProcess(params: {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  shell?: boolean;
}): Promise<CommandResult> {
  const args = params.args ?? [];
  const started = Date.now();
  const detached = process.platform !== 'win32';

  return await new Promise((resolve) => {
    const child = spawn(params.command, args, {
      cwd: params.cwd,
      env: params.env ?? process.env,
      shell: params.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (detached && child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      } else {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        if (detached && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }, 2000).unref();
    }, params.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        command: params.command,
        args,
        cwd: params.cwd,
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        command: params.command,
        args,
        cwd: params.cwd,
        exitCode: code ?? 0,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

async function loadOverlay(filePath?: string): Promise<OverlaySpec> {
  if (!filePath) return {};
  const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as OverlaySpec;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Overlay must be a JSON object.');
  }
  if (parsed.files && !Array.isArray(parsed.files)) {
    throw new Error('Overlay files must be an array.');
  }
  return parsed;
}

async function loadInstance(options: CliOptions): Promise<SweBenchInstance> {
  if (options.instanceFile) {
    const instance = JSON.parse(await readFile(options.instanceFile, 'utf-8')) as SweBenchInstance;
    if (!instance.instance_id) throw new Error('Instance file requires instance_id.');
    return instance;
  }

  const selector =
    options.instanceId !== undefined
      ? `instance_id=${JSON.stringify(options.instanceId)}`
      : `index=${options.index ?? 0}`;
  const code = `
import json
from datasets import load_dataset
dataset = load_dataset(${JSON.stringify(datasetName(options.subset))}, split=${JSON.stringify(options.split)})
${options.instanceId !== undefined ? `target = ${JSON.stringify(options.instanceId)}\nrow = next(dict(item) for item in dataset if item["instance_id"] == target)` : `row = dict(dataset[${options.index ?? 0}])`}
print(json.dumps(row))
`;
  const command =
    options.pythonLoader === 'python'
      ? { command: 'python3', args: ['-c', code] }
      : { command: 'uv', args: ['run', '--with', 'datasets', 'python', '-c', code] };
  const result = await runProcess({
    ...command,
    cwd: PROJECT_ROOT,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to load SWE-bench instance (${selector}): ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout) as SweBenchInstance;
}

async function git(args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return runProcess({ command: 'git', args, cwd, timeoutMs });
}

async function checkoutInstanceRepo(params: {
  instance: SweBenchInstance;
  outputDir: string;
  timeoutMs: number;
  sourceRepo?: string;
}): Promise<string> {
  if ((!params.instance.repo && !params.sourceRepo) || !params.instance.base_commit) {
    throw new Error('SWE-bench instance requires repo and base_commit for checkout.');
  }
  const repoDir = path.join(params.outputDir, 'work', params.instance.instance_id, 'repo');
  await mkdir(path.dirname(repoDir), { recursive: true });
  const init = await git(
    ['init', '--initial-branch=main', repoDir],
    PROJECT_ROOT,
    params.timeoutMs,
  );
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const remote = params.sourceRepo
    ? path.resolve(params.sourceRepo)
    : `https://github.com/${params.instance.repo}.git`;
  const commands = [
    ['remote', 'add', 'origin', remote],
    ['fetch', '--depth', '1', 'origin', params.instance.base_commit],
    ['checkout', '--force', 'FETCH_HEAD'],
    ['config', 'user.email', 'swebench-smoke@example.com'],
    ['config', 'user.name', 'SWE-bench Smoke'],
  ];
  for (const args of commands) {
    const result = await git(args, repoDir, params.timeoutMs);
    if (result.exitCode !== 0) {
      throw new Error(`git ${args[0]} failed: ${result.stderr || result.stdout}`);
    }
  }
  return repoDir;
}

export async function applyOverlayAndCommit(params: {
  repoDir: string;
  overlay: OverlaySpec;
  timeoutMs: number;
}): Promise<GateResult> {
  const files = params.overlay.files ?? [];
  if (files.length === 0) return skip('NO_OVERLAY_FILES', 'No overlay files were provided.');

  for (const file of files) {
    const relativePath = normalizeRelativePath(file.path);
    const fullPath = path.join(params.repoDir, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content, 'utf-8');
  }
  const add = await git(['add', '-A'], params.repoDir, params.timeoutMs);
  if (add.exitCode !== 0) return fail('OVERLAY_GIT_ADD_FAILED', add.stderr || add.stdout);
  const commit = await git(
    ['commit', '-m', 'SWE-bench smoke overlay'],
    params.repoDir,
    params.timeoutMs,
  );
  if (commit.exitCode !== 0) return fail('OVERLAY_COMMIT_FAILED', commit.stderr || commit.stdout);
  return pass('OVERLAY_COMMITTED', 'Overlay files were committed before agent execution.', {
    fileCount: files.length,
  });
}

function parseHeadlessMetadata(stdout: string): Record<string, any> {
  try {
    const parsed = JSON.parse(stdout) as { metadata?: Record<string, any> };
    return parsed.metadata ?? {};
  } catch {
    return {};
  }
}

async function writeCommandArtifact(
  dir: string,
  name: string,
  result: CommandResult,
): Promise<{ stdoutPath: string; stderrPath: string }> {
  const stdoutPath = path.join(dir, `${name}.stdout.log`);
  const stderrPath = path.join(dir, `${name}.stderr.log`);
  await writeFile(stdoutPath, result.stdout, 'utf-8');
  await writeFile(stderrPath, result.stderr, 'utf-8');
  return { stdoutPath, stderrPath };
}

async function runShellGate(params: {
  command?: string;
  repoDir: string;
  artifactDir: string;
  name: string;
  timeoutMs: number;
  missing: GateResult;
}): Promise<GateResult> {
  if (!params.command) return params.missing;
  const result = await runProcess({
    command: params.command,
    cwd: params.repoDir,
    timeoutMs: params.timeoutMs,
    shell: true,
  });
  const artifacts = await writeCommandArtifact(params.artifactDir, params.name, result);
  if (result.exitCode === 0 && !result.timedOut) {
    return pass(`${params.name.toUpperCase()}_PASSED`, `${params.name} command passed.`, {
      ...artifacts,
      durationMs: result.durationMs,
    });
  }
  return fail(`${params.name.toUpperCase()}_FAILED`, `${params.name} command failed.`, {
    ...artifacts,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  });
}

async function createPatchedWorktree(params: {
  repoDir: string;
  patchPath: string;
  artifactDir: string;
  timeoutMs: number;
  checkOnly?: boolean;
}): Promise<{ gate: GateResult; worktreeDir?: string }> {
  if (!existsSync(params.patchPath)) {
    return { gate: fail('PATCH_FILE_MISSING', 'Patch artifact does not exist.') };
  }
  const patch = await readFile(params.patchPath, 'utf-8');
  if (!patch) {
    return { gate: fail('EMPTY_PATCH_NOT_APPLYABLE', 'No patch was produced.') };
  }

  const worktreeDir = await mkdtemp(path.join(params.artifactDir, 'patched-worktree-'));
  const addWorktree = await git(
    ['worktree', 'add', '--detach', '--quiet', worktreeDir, 'HEAD'],
    params.repoDir,
    params.timeoutMs,
  );
  if (addWorktree.exitCode !== 0) {
    await rm(worktreeDir, { recursive: true, force: true });
    return {
      gate: fail('PATCHED_WORKTREE_CREATE_FAILED', addWorktree.stderr || addWorktree.stdout, {
        exitCode: addWorktree.exitCode,
      }),
    };
  }

  const applyArgs = params.checkOnly
    ? ['apply', '--check', params.patchPath]
    : ['apply', params.patchPath];
  const apply = await git(applyArgs, worktreeDir, params.timeoutMs);
  if (apply.exitCode !== 0) {
    await git(['worktree', 'remove', '--force', worktreeDir], params.repoDir, params.timeoutMs).catch(
      () => undefined,
    );
    await rm(worktreeDir, { recursive: true, force: true });
    return {
      gate: fail(
        params.checkOnly ? 'GIT_APPLY_CHECK_FAILED' : 'PATCHED_WORKTREE_APPLY_FAILED',
        apply.stderr || apply.stdout,
        { exitCode: apply.exitCode },
      ),
    };
  }

  return {
    gate: params.checkOnly
      ? pass('GIT_APPLY_CHECK_OK', 'Patch applies cleanly to a clean benchmark worktree.')
      : pass('PATCHED_WORKTREE_READY', 'Patch was applied to a clean benchmark worktree.'),
    worktreeDir,
  };
}

async function removePatchedWorktree(params: {
  repoDir: string;
  worktreeDir?: string;
  timeoutMs: number;
}): Promise<void> {
  if (!params.worktreeDir) return;
  await git(['worktree', 'remove', '--force', params.worktreeDir], params.repoDir, params.timeoutMs).catch(
    () => undefined,
  );
  await rm(params.worktreeDir, { recursive: true, force: true });
}

function unavailablePatchedGate(name: string, gate: GateResult): GateResult {
  return fail(`${name.toUpperCase()}_PATCHED_WORKTREE_UNAVAILABLE`, gate.message, {
    code: gate.code,
    ...(gate.details ? { details: gate.details } : {}),
  });
}

export async function runPatchedShellGates(params: {
  behaviorCommand?: string;
  regressionCommand?: string;
  repoDir: string;
  patchPath: string;
  artifactDir: string;
  timeoutMs: number;
}): Promise<Pick<SmokeReport['gates'], 'behavior' | 'regression'>> {
  const missingBehavior = fail(
    'BEHAVIOR_COMMAND_MISSING',
    'No reproduction behavior command was provided; behavior cannot be verified.',
  );
  const missingRegression = skip(
    'REGRESSION_COMMAND_MISSING',
    'No PASS_TO_PASS regression command was provided.',
  );

  if (!params.behaviorCommand && !params.regressionCommand) {
    return { behavior: missingBehavior, regression: missingRegression };
  }

  const patched = await createPatchedWorktree({
    repoDir: params.repoDir,
    patchPath: params.patchPath,
    artifactDir: params.artifactDir,
    timeoutMs: params.timeoutMs,
  });
  if (!patched.worktreeDir) {
    return {
      behavior: params.behaviorCommand
        ? unavailablePatchedGate('behavior', patched.gate)
        : missingBehavior,
      regression: params.regressionCommand
        ? unavailablePatchedGate('regression', patched.gate)
        : missingRegression,
    };
  }

  try {
    const behavior = await runShellGate({
      command: params.behaviorCommand,
      repoDir: patched.worktreeDir,
      artifactDir: params.artifactDir,
      name: 'behavior',
      timeoutMs: params.timeoutMs,
      missing: missingBehavior,
    });
    const regression = await runShellGate({
      command: params.regressionCommand,
      repoDir: patched.worktreeDir,
      artifactDir: params.artifactDir,
      name: 'regression',
      timeoutMs: params.timeoutMs,
      missing: missingRegression,
    });
    return { behavior, regression };
  } finally {
    await removePatchedWorktree({
      repoDir: params.repoDir,
      worktreeDir: patched.worktreeDir,
      timeoutMs: params.timeoutMs,
    });
  }
}

function parseLastPrediction(predictionsText: string): {
  ok: boolean;
  prediction?: SweBenchPrediction;
  error?: string;
} {
  try {
    const lines = predictionsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return { ok: false, error: 'No prediction lines found.' };
    const parsed = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    if (
      typeof parsed.instance_id !== 'string' ||
      typeof parsed.model_name_or_path !== 'string' ||
      typeof parsed.model_patch !== 'string'
    ) {
      return {
        ok: false,
        error: 'Prediction requires instance_id, model_name_or_path, model_patch.',
      };
    }
    return {
      ok: true,
      prediction: {
        instance_id: parsed.instance_id,
        model_name_or_path: parsed.model_name_or_path,
        model_patch: parsed.model_patch,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runPreSubmitGate(params: {
  repoDir: string;
  patchPath: string;
  predictionsPath: string;
  artifactDir: string;
  timeoutMs: number;
}): Promise<{
  patch: string;
  changedFiles: string[];
  patchSha256: string;
  patchBytes: number;
  gates: Pick<
    SmokeReport['gates'],
    'patchNonEmpty' | 'predictionParse' | 'predictionPatch' | 'gitDiffCheck' | 'gitApplyCheck'
  >;
}> {
  const patch = existsSync(params.patchPath) ? await readFile(params.patchPath, 'utf-8') : '';
  const patchSha256 = createHash('sha256').update(patch).digest('hex');
  const artifact = await buildBenchmarkPatchArtifact({
    repoPath: params.repoDir,
    excludePaths: [params.patchPath, params.predictionsPath],
  });

  const predictionsText = existsSync(params.predictionsPath)
    ? await readFile(params.predictionsPath, 'utf-8')
    : '';
  const parsedPrediction = parseLastPrediction(predictionsText);
  const normalizedPatch = normalizePatchText(patch);
  const predictionPatch =
    parsedPrediction.ok && parsedPrediction.prediction
      ? (() => {
          const predictionPatchText = normalizePatchText(parsedPrediction.prediction.model_patch);
          const patchGate = checkBenchmarkPatch(predictionPatchText);
          if (patchGate.status !== 'pass') return patchGate;
          if (predictionPatchText !== normalizedPatch) {
            return fail(
              'PREDICTION_PATCH_MISMATCH',
              'SWE-bench model_patch must match the exported patch artifact.',
              {
                exportedPatchSha256: patchSha256,
                predictionPatchSha256: createHash('sha256')
                  .update(predictionPatchText)
                  .digest('hex'),
              },
            );
          }
          return pass(
            'PREDICTION_PATCH_MATCHES_EXPORT',
            'SWE-bench model_patch matches the exported patch artifact.',
            { patchSha256 },
          );
        })()
      : fail('PREDICTION_PATCH_UNAVAILABLE', 'Cannot validate model_patch before prediction parses.');
  const predictionParse = parsedPrediction.ok
    ? pass('PREDICTION_PARSE_OK', 'SWE-bench prediction JSONL has required fields.', {
        instanceId: parsedPrediction.prediction?.instance_id,
        modelNameOrPath: parsedPrediction.prediction?.model_name_or_path,
      })
    : fail('PREDICTION_PARSE_FAILED', parsedPrediction.error ?? 'Invalid predictions file.');

  const diffCheck = await git(['diff', '--check'], params.repoDir, params.timeoutMs);
  const gitDiffCheck =
    diffCheck.exitCode === 0
      ? pass('GIT_DIFF_CHECK_OK', 'Patch has no whitespace errors.')
      : fail('GIT_DIFF_CHECK_FAILED', diffCheck.stderr || diffCheck.stdout, {
          exitCode: diffCheck.exitCode,
        });

  let gitApplyCheck: GateResult;
  if (!patch) {
    gitApplyCheck = fail('EMPTY_PATCH_NOT_APPLYABLE', 'No patch was produced.');
  } else {
    const check = await createPatchedWorktree({
      repoDir: params.repoDir,
      patchPath: params.patchPath,
      artifactDir: params.artifactDir,
      timeoutMs: params.timeoutMs,
      checkOnly: true,
    });
    try {
      gitApplyCheck =
        check.gate.code === 'PATCHED_WORKTREE_CREATE_FAILED'
          ? fail('GIT_APPLY_CHECK_WORKTREE_FAILED', check.gate.message, check.gate.details)
          : check.gate;
    } finally {
      await removePatchedWorktree({
        repoDir: params.repoDir,
        worktreeDir: check.worktreeDir,
        timeoutMs: params.timeoutMs,
      });
    }
  }

  return {
    patch,
    changedFiles: artifact.changedFiles,
    patchSha256,
    patchBytes: Buffer.byteLength(patch, 'utf-8'),
    gates: {
      patchNonEmpty:
        patch.length > 0
          ? pass('PATCH_NON_EMPTY', 'Agent produced a non-empty patch.', {
              bytes: Buffer.byteLength(patch, 'utf-8'),
            })
          : fail('PATCH_EMPTY', 'Agent produced an empty patch.'),
      predictionParse,
      predictionPatch,
      gitDiffCheck,
      gitApplyCheck,
    },
  };
}

async function runSubmit(params: {
  options: RunSubmitOptions;
  outputDir: string;
  predictionsPath: string;
  runId: string;
  instanceId: string;
}): Promise<{ gate: GateResult; resolved?: boolean }> {
  const apiKey = process.env[params.options.apiKeyEnv];
  if (!apiKey) {
    return {
      gate: fail(
        'SUBMISSION_API_KEY_MISSING',
        `Missing ${params.options.apiKeyEnv}; cannot submit.`,
      ),
    };
  }

  const reportDir = path.join(params.outputDir, 'sb-cli-reports');
  await mkdir(reportDir, { recursive: true });
  const result = await runProcess({
    command: params.options.sbCli,
    args: [
      'submit',
      params.options.subset === 'lite' ? 'swe-bench_lite' : params.options.subset,
      params.options.split,
      '--predictions_path',
      params.predictionsPath,
      '--run_id',
      params.runId,
      '--instance_ids',
      params.instanceId,
      '--output_dir',
      reportDir,
      '--overwrite',
      '1',
      '--verify_submission',
      '1',
      '--wait_for_evaluation',
      '1',
      '--gen_report',
      '1',
    ],
    cwd: PROJECT_ROOT,
    env: { ...process.env, [params.options.apiKeyEnv]: apiKey },
    timeoutMs: params.options.timeoutMs,
  });
  await writeCommandArtifact(params.outputDir, 'sb-cli-submit', result);
  if (result.exitCode !== 0 || result.timedOut) {
    return {
      gate: fail('SUBMISSION_FAILED', 'sb-cli submit failed.', {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      }),
    };
  }

  const reportPath = path.join(
    reportDir,
    `${params.options.subset === 'lite' ? 'swe-bench_lite' : params.options.subset}__${params.options.split}__${params.runId}.json`,
  );
  if (!existsSync(reportPath)) {
    return { gate: fail('SUBMISSION_REPORT_MISSING', 'sb-cli did not write a report.') };
  }
  const report = JSON.parse(await readFile(reportPath, 'utf-8')) as {
    resolved_ids?: string[];
    failed_ids?: string[];
    error_ids?: string[];
  };
  const resolved = (report.resolved_ids ?? []).includes(params.instanceId);
  return {
    gate: resolved
      ? pass('SUBMISSION_RESOLVED', 'SWE-bench cloud report resolved the instance.', {
          reportPath,
        })
      : fail('SUBMISSION_UNRESOLVED', 'SWE-bench cloud report did not resolve the instance.', {
          reportPath,
          failedIds: report.failed_ids ?? [],
          errorIds: report.error_ids ?? [],
        }),
    resolved,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = options.out
    ? path.resolve(options.out)
    : await mkdtemp(path.join(os.tmpdir(), 'salmonloop-swebench-smoke-'));
  const runId = `salmon-loop-swebench-smoke-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
  const artifactDir = path.join(outputDir, 'artifacts');
  await mkdir(artifactDir, { recursive: true });

  let repoDir = '';
  try {
    const instance = await loadInstance(options);
    repoDir = await checkoutInstanceRepo({
      instance,
      outputDir,
      timeoutMs: options.timeoutMs,
      sourceRepo: options.sourceRepo,
    });
    const overlay = await loadOverlay(options.overlay);
    const mergedOverlay: OverlaySpec = {
      ...overlay,
      behaviorCommand: options.behaviorCommand ?? overlay.behaviorCommand,
      regressionCommand: options.regressionCommand ?? overlay.regressionCommand,
    };
    const overlayGate = await applyOverlayAndCommit({
      repoDir,
      overlay: mergedOverlay,
      timeoutMs: options.timeoutMs,
    });

    const patchPath = path.join(artifactDir, `${instance.instance_id}.patch`);
    const predictionsPath = path.join(outputDir, 'preds.jsonl');
    const stdoutPath = path.join(artifactDir, `${instance.instance_id}.stdout.json`);
    const stderrPath = path.join(artifactDir, `${instance.instance_id}.stderr.log`);
    const reportPath = path.join(outputDir, 'report.json');
    const verifyCommand = options.verify ?? mergedOverlay.behaviorCommand ?? 'true';
    const commandArgs = [
      CLI_ENTRY,
      'run',
      '--repo',
      repoDir,
      '--instruction',
      String(instance.problem_statement ?? ''),
      '--output-format',
      'json',
      '--act-mode',
      options.actMode,
      '--checkpoint-strategy',
      options.checkpointStrategy,
      '--verify',
      verifyCommand,
      '--export-patch',
      patchPath,
      '--swe-bench-instance-id',
      instance.instance_id,
      '--swe-bench-model-name',
      options.modelName,
      '--swe-bench-predictions',
      predictionsPath,
    ];
    if (options.config) commandArgs.splice(4, 0, '--config', path.resolve(options.config));

    const run = await runProcess({
      command: process.execPath,
      args: commandArgs,
      cwd: PROJECT_ROOT,
      timeoutMs: options.timeoutMs,
      env: { ...process.env, NO_COLOR: '1' },
    });
    await writeFile(stdoutPath, run.stdout, 'utf-8');
    await writeFile(stderrPath, run.stderr, 'utf-8');

    const metadata = parseHeadlessMetadata(run.stdout);
    const preSubmit = await runPreSubmitGate({
      repoDir,
      patchPath,
      predictionsPath,
      artifactDir,
      timeoutMs: options.timeoutMs,
    });
    const patchedShellGates = await runPatchedShellGates({
      behaviorCommand: mergedOverlay.behaviorCommand,
      regressionCommand: mergedOverlay.regressionCommand,
      repoDir,
      patchPath,
      artifactDir,
      timeoutMs: options.timeoutMs,
    });
    const gates: SmokeReport['gates'] = {
      overlay: overlayGate,
      reproduction: classifyReproductionCommand(mergedOverlay.behaviorCommand),
      verifyStrength: classifyVerifyStrength(verifyCommand),
      ...preSubmit.gates,
      behavior: patchedShellGates.behavior,
      regression: patchedShellGates.regression,
      submission: skip('SUBMISSION_NOT_EVALUATED', 'Submission gate is evaluated after local gates.'),
    };
    const flowSuccess = run.exitCode === 0 && metadata.success === true;
    const localQuality = buildQualitySummary({
      flowSuccess,
      gates,
    });
    const submission =
      options.submit && localQuality.passedLocalQualityBar
        ? await runSubmit({
            options: { ...options, submit: true },
            outputDir,
            predictionsPath,
            runId,
            instanceId: instance.instance_id,
          })
        : {
            gate: options.submit
              ? skip(
                  'SUBMISSION_SKIPPED_LOCAL_QUALITY_FAILED',
                  'Local benchmark quality gates failed; sb-cli submission was skipped.',
                )
              : skip('SUBMISSION_DISABLED', 'sb-cli submission disabled.'),
          };
    gates.submission = submission.gate;
    const report: SmokeReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runId,
      smokeKind: deriveSmokeKind({
        submit: options.submit,
        warnings: metadata.warnings,
      }),
      workspace: {
        outputDir,
        repoDir,
        kept: !options.cleanup,
      },
      instance: {
        instanceId: instance.instance_id,
        repo: instance.repo,
        baseCommit: instance.base_commit,
      },
      commands: {
        verifyCommand,
        behaviorCommand: mergedOverlay.behaviorCommand,
        regressionCommand: mergedOverlay.regressionCommand,
      },
      flow: {
        exitCode: run.exitCode,
        success: flowSuccess,
        reasonCode: metadata.reason_code,
        diagnosticCode: metadata.diagnostic_code,
      },
      artifacts: {
        patchPath,
        predictionsPath,
        stdoutPath,
        stderrPath,
        reportPath,
        patchSha256: preSubmit.patchSha256,
        patchBytes: preSubmit.patchBytes,
        changedFiles: preSubmit.changedFiles,
      },
      gates,
      quality: buildQualitySummary({
        flowSuccess,
        gates,
        resolved: submission.resolved,
      }),
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = resolveSmokeExitCode({ quality: report.quality, submit: options.submit });
  } finally {
    if (options.cleanup && !options.out) {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
