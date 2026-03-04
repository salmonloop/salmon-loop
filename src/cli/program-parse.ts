import type { CliRuntimeContext } from './cli-runtime-context.js';
import {
  emitHeadlessCommanderUsageError,
  getCommanderErrorExitCode,
  isCommanderError,
  shouldExitCommanderError,
} from './program-error-adapter.js';

export function configureProgramOutputForHeadless(context: CliRuntimeContext): void {
  if (!context.headlessDetection.outputFormat) return;
  context.program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  context.program.showHelpAfterError(false);
  context.program.showSuggestionAfterError(false);
}

export async function parseProgramOrExit(context: CliRuntimeContext): Promise<void> {
  try {
    await context.program.parseAsync(context.rewrittenArgv);
  } catch (err: unknown) {
    if (isCommanderError(err)) {
      emitHeadlessCommanderUsageError({
        err,
        headlessDetection: context.headlessDetection,
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
