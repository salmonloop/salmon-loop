/**
 * Subprocess eval provider.
 *
 * Spawns CLI subprocesses per evaluation case and collects audit artifacts.
 * Extracted from scripts/evaluation-runner.ts.
 */

import { copyFile, mkdir, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';

import type { EvalProvider, EvalResult, EvalRunOptions, EvalTaskDefinition } from '../types.js';

// ─── Internal Types ───

interface SubprocessTaskMeta {
  file: string;
}

export interface SubprocessConfig {
  repoPath: string;
  configPath: string;
  outputDir: string;
  verifyCommand?: string;
  checkpointStrategy?: string;
  worktreePrepare?: string;
}

interface AuditArtifact {
  auditPath: string;
  eventsPath: string | null;
}

interface HeadlessRunOutput {
  metadata?: {
    success?: boolean;
    reason?: string;
    error_code?: string;
    audit_path?: string;
  };
}

// ─── Helpers ───

async function readProcessStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
  if (!stream) return '';
  return await new Response(stream).text();
}

export function buildRunCommandArgs(params: {
  repoPath: string;
  configPath: string;
  instruction: string;
  file: string;
  verifyCommand: string;
  checkpointStrategy: string;
  worktreePrepare?: string;
}): string[] {
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

// ─── Provider ───

export function createSubprocessProvider(config: SubprocessConfig): EvalProvider {
  const knownAuditPaths = new Set<string>();

  return {
    name: 'subprocess',

    async loadTasks(source: string): Promise<EvalTaskDefinition[]> {
      const raw = await readFile(source, 'utf-8');
      const parsed = JSON.parse(raw) as { cases: Array<{ id: string; file: string; instruction: string }> };
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) {
        throw new Error('Invalid case file: expected top-level "cases" array');
      }

      return parsed.cases.map((item) => ({
        id: item.id,
        instruction: item.instruction,
        providerMeta: { file: item.file } satisfies SubprocessTaskMeta,
      }));
    },

    async runTask(task, options: EvalRunOptions): Promise<EvalResult> {
      const meta = task.providerMeta as unknown as SubprocessTaskMeta;
      const verbose = options.verbose ?? false;
      const startedAt = Date.now();

      if (verbose) process.stderr.write(`  [START] ${task.id}\n`);

      const runnerRoot = process.cwd();
      const outputDir = config.outputDir;
      await mkdir(outputDir, { recursive: true });

      const auditDir = path.join(config.repoPath, '.salmonloop', 'runtime', 'audit');

      const stdoutPath = path.join(outputDir, `${task.id}.stdout.json`);
      const stderrPath = path.join(outputDir, `${task.id}.stderr.log`);

      const bunRuntime = (globalThis as { Bun?: typeof Bun }).Bun;
      if (!bunRuntime) {
        return {
          taskId: task.id,
          provider: 'subprocess',
          success: false,
          reasonCode: 'NO_BUN',
          attempts: 0,
          durationMs: Date.now() - startedAt,
          error: 'Bun runtime is required to execute subprocess eval provider',
        };
      }

      try {
        const subprocess = bunRuntime.spawn(
          [
            process.execPath,
            ...buildRunCommandArgs({
              repoPath: config.repoPath,
              configPath: config.configPath,
              instruction: task.instruction,
              file: meta.file,
              verifyCommand: config.verifyCommand ?? 'node -e "process.exit(0)"',
              checkpointStrategy: config.checkpointStrategy ?? 'worktree',
              worktreePrepare: config.worktreePrepare,
            }),
          ],
          {
            cwd: runnerRoot,
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

        const detectedAudit = await detectNewestAuditArtifact(auditDir, knownAuditPaths);
        let auditPath: string | null = null;
        if (detectedAudit) {
          knownAuditPaths.add(detectedAudit.auditPath);
          auditPath = detectedAudit.auditPath;
          await copyFile(
            detectedAudit.auditPath,
            path.join(outputDir, `${task.id}.audit.json`),
          );
          if (detectedAudit.eventsPath) {
            await copyFile(
              detectedAudit.eventsPath,
              path.join(outputDir, `${task.id}.events.jsonl`),
            );
          }
        }

        const success = parsedStdout?.metadata?.success === true;

        if (verbose) {
          const status = success ? 'PASS' : 'FAIL';
          console.log(`  [${status}] ${task.id} — exit=${exitCode} (${Date.now() - startedAt}ms)`);
        }

        return {
          taskId: task.id,
          provider: 'subprocess',
          success,
          reasonCode: parsedStdout?.metadata?.error_code ?? (success ? 'SUCCESS' : 'FAILED'),
          attempts: 1,
          durationMs: Date.now() - startedAt,
          providerMeta: {
            exitCode,
            auditPath: parsedStdout?.metadata?.audit_path ?? auditPath,
            reason: parsedStdout?.metadata?.reason,
          },
          error: success ? undefined : (parsedStdout?.metadata?.reason ?? `exit code ${exitCode}`),
        };
      } catch (error) {
        if (verbose) {
          console.log(`  [CRASH] ${task.id} — ${error instanceof Error ? error.message : String(error)}`);
        }

        return {
          taskId: task.id,
          provider: 'subprocess',
          success: false,
          reasonCode: 'CRASH',
          attempts: 0,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
