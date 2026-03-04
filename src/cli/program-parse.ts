import type { Command } from 'commander';

import type { DetectedHeadlessOutput } from './argv/headless-detection.js';
import {
  emitHeadlessCommanderUsageError,
  getCommanderErrorExitCode,
  isCommanderError,
  shouldExitCommanderError,
} from './program-error-adapter.js';

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
    if (isCommanderError(err)) {
      emitHeadlessCommanderUsageError({
        err,
        headlessDetection: params.headlessDetection,
      });
      if (shouldExitCommanderError(err)) {
        process.exit(getCommanderErrorExitCode(err));
      }
      return;
    }

    import('../core/observability/logger.js').then(({ logger }) => {
      logger.error('CLI execution crashed', err, true);
    });
  }
}
