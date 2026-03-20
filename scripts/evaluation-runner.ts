import { copyFile, mkdir, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';

type EvaluationCase = {
  id: string;
  file: string;
  instruction: string;
};

type EvaluationCaseFile = {
  cases: EvaluationCase[];
};

type RunCommandParams = {
  repoPath: string;
  configPath: string;
  instruction: string;
  file: string;
  verifyCommand: string;
  checkpointStrategy: string;
  worktreePrepare?: string;
};

type AuditArtifact = {
  auditPath: string;
  eventsPath: string | null;
};

type EvaluationResult = {
  id: string;
  file: string;
  exitCode: number;
  success: boolean;
  errorCode: string | null;
  reason: string | null;
  auditPath: string | null;
};

type EvaluationSummary = {
  generatedAt: string;
  evalId: string;
  taskCount: number;
  successRuns: number;
  failedRuns: number;
  results: EvaluationResult[];
};

type CliOptions = {
  repoPath: string;
  configPath: string;
  casesPath: string;
  outputDir: string;
  verifyCommand: string;
  checkpointStrategy: string;
  worktreePrepare?: string;
};

type HeadlessRunOutput = {
  metadata?: {
    success?: boolean;
    reason?: string;
    error_code?: string;
    audit_path?: string;
  };
};

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }
  return value;
}

export async function loadEvaluationCases(filePath: string): Promise<EvaluationCase[]> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as EvaluationCaseFile;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) {
    throw new Error('Invalid case file: expected top-level "cases" array');
  }

  return parsed.cases.map((item, index) => ({
    id: assertString(item?.id, `cases[${index}].id`),
    file: assertString(item?.file, `cases[${index}].file`),
    instruction: assertString(item?.instruction, `cases[${index}].instruction`),
  }));
}

export function buildRunCommandArgs(params: RunCommandParams): string[] {
  const args = [
    'src/cli/index.ts',
    'run',
    '-r',
    params.repoPath,
    '--config',
    params.configPath,
    '-i',
    params.instruction,
    '-f',
    params.file,
    '-v',
    params.verifyCommand,
    '--checkpoint-strategy',
    params.checkpointStrategy,
  ];

  if (params.worktreePrepare) {
    args.push('--worktree-prepare', params.worktreePrepare);
  }

  args.push('--dry-run', '--output-format', 'json');
  return args;
}

export async function detectNewestAuditArtifact(
  auditDir: string,
  knownAuditPaths: Set<string>,
): Promise<AuditArtifact | null> {
  const entries = await readdir(auditDir, { withFileTypes: true });
  const auditFiles = entries
    .filter((entry) => entry.isFile() && /^audit-.*\.json$/.test(entry.name))
    .map((entry) => path.join(auditDir, entry.name))
    .filter((fullPath) => !knownAuditPaths.has(fullPath))
    .sort();

  const auditPath = auditFiles.at(-1);
  if (!auditPath) return null;

  const raw = await readFile(auditPath, 'utf-8');
  const parsed = JSON.parse(raw) as { context?: { eventsRef?: { path?: string } } };
  const eventsRelativePath = parsed.context?.eventsRef?.path;
  const eventsPath = eventsRelativePath
    ? path.join(path.dirname(auditPath), eventsRelativePath)
    : null;

  return { auditPath, eventsPath };
}

export function buildEvaluationSummary(params: {
  evalId: string;
  results: EvaluationResult[];
}): EvaluationSummary {
  const successRuns = params.results.filter((item) => item.success).length;
  return {
    generatedAt: new Date().toISOString(),
    evalId: params.evalId,
    taskCount: params.results.length,
    successRuns,
    failedRuns: params.results.length - successRuns,
    results: params.results,
  };
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    verifyCommand: 'node -e "process.exit(0)"',
    checkpointStrategy: 'worktree',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--repo') {
      options.repoPath = next;
      index += 1;
      continue;
    }
    if (token === '--config') {
      options.configPath = next;
      index += 1;
      continue;
    }
    if (token === '--cases') {
      options.casesPath = next;
      index += 1;
      continue;
    }
    if (token === '--out') {
      options.outputDir = next;
      index += 1;
      continue;
    }
    if (token === '--verify') {
      options.verifyCommand = next;
      index += 1;
      continue;
    }
    if (token === '--checkpoint-strategy') {
      options.checkpointStrategy = next;
      index += 1;
      continue;
    }
    if (token === '--worktree-prepare') {
      options.worktreePrepare = next;
      index += 1;
      continue;
    }
  }

  return {
    repoPath: assertString(options.repoPath, '--repo'),
    configPath: assertString(options.configPath, '--config'),
    casesPath: assertString(options.casesPath, '--cases'),
    outputDir: assertString(options.outputDir, '--out'),
    verifyCommand: assertString(options.verifyCommand, '--verify'),
    checkpointStrategy: assertString(options.checkpointStrategy, '--checkpoint-strategy'),
    worktreePrepare: options.worktreePrepare,
  };
}

async function readProcessStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
  if (!stream) return '';
  return await new Response(stream).text();
}

async function runSingleCase(params: {
  runnerRoot: string;
  auditDir: string;
  outputDir: string;
  knownAuditPaths: Set<string>;
  runParams: Omit<RunCommandParams, 'instruction' | 'file'>;
  evaluationCase: EvaluationCase;
}): Promise<EvaluationResult> {
  const stdoutPath = path.join(params.outputDir, `${params.evaluationCase.id}.stdout.json`);
  const stderrPath = path.join(params.outputDir, `${params.evaluationCase.id}.stderr.log`);

  const bunRuntime = (globalThis as { Bun?: typeof Bun }).Bun;
  if (!bunRuntime) {
    throw new Error('Bun runtime is required to execute evaluation runner');
  }

  const subprocess = bunRuntime.spawn(
    [
      process.execPath,
      ...buildRunCommandArgs({
        ...params.runParams,
        instruction: params.evaluationCase.instruction,
        file: params.evaluationCase.file,
      }),
    ],
    {
      cwd: params.runnerRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    },
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    readProcessStream(subprocess.stdout),
    readProcessStream(subprocess.stderr),
  ]);

  await writeFile(stdoutPath, stdout, 'utf-8');
  await writeFile(stderrPath, stderr, 'utf-8');

  let parsedStdout: HeadlessRunOutput | null = null;
  try {
    parsedStdout = JSON.parse(stdout) as HeadlessRunOutput;
  } catch {
    parsedStdout = null;
  }

  const detectedAudit = await detectNewestAuditArtifact(params.auditDir, params.knownAuditPaths);
  let auditPath: string | null = null;
  if (detectedAudit) {
    params.knownAuditPaths.add(detectedAudit.auditPath);
    auditPath = detectedAudit.auditPath;
    await copyFile(
      detectedAudit.auditPath,
      path.join(params.outputDir, `${params.evaluationCase.id}.audit.json`),
    );
    if (detectedAudit.eventsPath) {
      await copyFile(
        detectedAudit.eventsPath,
        path.join(params.outputDir, `${params.evaluationCase.id}.events.jsonl`),
      );
    }
  }

  return {
    id: params.evaluationCase.id,
    file: params.evaluationCase.file,
    exitCode,
    success: parsedStdout?.metadata?.success === true,
    errorCode: parsedStdout?.metadata?.error_code ?? null,
    reason: parsedStdout?.metadata?.reason ?? null,
    auditPath: parsedStdout?.metadata?.audit_path ?? auditPath,
  };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const cases = await loadEvaluationCases(options.casesPath);

  await mkdir(options.outputDir, { recursive: true });
  const auditDir = path.join(options.repoPath, '.salmonloop', 'runtime', 'audit');
  const existingAuditEntries = await readdir(auditDir, { withFileTypes: true }).catch(() => []);
  const knownAuditPaths = new Set(
    existingAuditEntries
      .filter((entry) => entry.isFile() && /^audit-.*\.json$/.test(entry.name))
      .map((entry) => path.join(auditDir, entry.name)),
  );

  const results: EvaluationResult[] = [];
  for (const evaluationCase of cases) {
    const result = await runSingleCase({
      runnerRoot: process.cwd(),
      auditDir,
      outputDir: options.outputDir,
      knownAuditPaths,
      evaluationCase,
      runParams: {
        repoPath: options.repoPath,
        configPath: options.configPath,
        verifyCommand: options.verifyCommand,
        checkpointStrategy: options.checkpointStrategy,
        worktreePrepare: options.worktreePrepare,
      },
    });
    results.push(result);
  }

  const summary = buildEvaluationSummary({
    evalId: path.basename(options.outputDir),
    results,
  });
  await writeFile(
    path.join(options.outputDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.main) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
