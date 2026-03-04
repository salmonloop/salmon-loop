import type { CliRuntimeContext } from './cli-runtime-context.js';
import {
  emitHeadlessCommanderUsageError,
  getCommanderErrorExitCode,
  isCommanderError,
  shouldExitCommanderError,
} from './commander-error-adapter.js';
import { reportCliCrash } from './crash-reporter.js';

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
    reportCliCrash(err);
  }
}
