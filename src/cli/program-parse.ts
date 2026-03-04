import type { Command } from 'commander';

import type { DetectedHeadlessOutput } from './argv/headless-detection.js';
import { createHeadlessErrorWriter } from './commands/run/headless-error-writer.js';
import { createStdoutWriter } from './headless/stdout-writer.js';

function getCommanderCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

function getCommanderExitCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'exitCode' in err) {
    return (err as { exitCode?: number }).exitCode;
  }
  return undefined;
}

function isCommanderHelpLike(code: string | undefined): boolean {
  return code === 'commander.helpDisplayed' || code === 'commander.version';
}

export function configureProgramOutputForHeadless(
  program: Command,
  headlessDetection: DetectedHeadlessOutput,
): void {
  if (!headlessDetection.outputFormat) return;
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  program.showHelpAfterError(false);
  program.showSuggestionAfterError(false);
}

export async function parseProgramOrExit(params: {
  program: Command;
  argv: string[];
  headlessDetection: DetectedHeadlessOutput;
}): Promise<void> {
  try {
    await params.program.parseAsync(params.argv);
  } catch (err: unknown) {
    const isCommanderError = (err instanceof Error ? err.name : undefined) === 'CommanderError';
    if (isCommanderError) {
      const code = getCommanderCode(err);
      if (params.headlessDetection.outputFormat && !isCommanderHelpLike(code)) {
        const writer = createStdoutWriter();
        const headlessErrorWriter = createHeadlessErrorWriter({
          repoPath: params.headlessDetection.repoPath ?? process.cwd(),
          outputFormat: params.headlessDetection.outputFormat,
          outputProfileForStreamJson: params.headlessDetection.outputProfile ?? 'native',
          writer,
          getSessionId: () => undefined,
          getResumeSessionId: () => params.headlessDetection.resumeSessionId,
        });
        headlessErrorWriter.writeUsageError({
          message: err instanceof Error ? err.message : String(err),
          instruction: params.headlessDetection.instruction,
        });
        process.exit(1);
      }

      if (!isCommanderHelpLike(code)) {
        process.exit(getCommanderExitCode(err) || 1);
      }
      return;
    }

    import('../core/observability/logger.js').then(({ logger }) => {
      logger.error('CLI execution crashed', err, true);
    });
  }
}
