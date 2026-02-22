import { execa } from 'execa';

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function splitJsonLines(text: string): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines;
}

function assertJsonl(stdout: string): void {
  const lines = splitJsonLines(stdout);
  if (lines.length === 0) {
    throw new Error('Expected JSONL on stdout but got empty output.');
  }
  for (const [idx, line] of lines.entries()) {
    try {
      JSON.parse(line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSON on stdout line ${idx + 1}: ${msg}\nLine: ${line}`);
    }
  }
}

async function runCli(args: string[], env?: NodeJS.ProcessEnv): Promise<RunResult> {
  const result = await execa('node', ['--import', 'tsx', 'src/cli/index.ts', ...args], {
    reject: false,
    env: { ...process.env, ...(env ?? {}) },
  });

  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function smokeUsageErrorJsonl(): Promise<void> {
  const res = await runCli([
    'run',
    '-p',
    'hello',
    '--output-format',
    'stream-json',
    '--continue',
    '--resume',
    'sess_test',
  ]);

  if (res.exitCode === 0) {
    throw new Error('Expected usage error (exit code != 0) but got success.');
  }

  assertJsonl(res.stdout);
}

async function smokeStreamJsonlProfile(profile: 'native' | 'anthropic' | 'openai'): Promise<void> {
  const res = await runCli([
    'run',
    '-p',
    'Say hello.',
    '--output-format',
    'stream-json',
    '--output-profile',
    profile,
  ]);

  if (res.exitCode !== 0) {
    const tail = res.stderr.split('\n').slice(-20).join('\n');
    throw new Error(`Expected success but got exit code ${res.exitCode}.\nStderr tail:\n${tail}`);
  }

  assertJsonl(res.stdout);
}

function shouldRunRealProviderSmoke(): boolean {
  const hasKey = Boolean(
    process.env.SALMONLOOP_API_KEY ||
    process.env.S8P_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY,
  );
  return hasKey;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const profilesArg = args.find((a) => a.startsWith('--profiles='));
  const profiles = (profilesArg?.split('=')[1] ?? 'native,anthropic,openai')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean) as Array<'native' | 'anthropic' | 'openai'>;

  await smokeUsageErrorJsonl();

  if (!shouldRunRealProviderSmoke()) {
    // This script is intended for real-provider smoke runs. If no keys are present,
    // only run deterministic usage-error checks.
    return;
  }

  for (const profile of profiles) {
    await smokeStreamJsonlProfile(profile);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error(msg);
  process.exitCode = 1;
});
