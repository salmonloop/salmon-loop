import type { CliRuntimeContext } from './cli-runtime-context.js';
import {
  emitHeadlessCommanderUsageError,
  getCommanderErrorExitCode,
  isCommanderError,
  shouldExitCommanderError,
} from './commander-error-adapter.js';
import { reportCliCrash } from './crash-reporter.js';

export type ProgramParseStatus = 'ok' | 'exited' | 'crash-reported';

export async function parseProgramOrExit(
  context: CliRuntimeContext,
): Promise<{ status: ProgramParseStatus }> {
  try {
    await context.program.parseAsync(context.rewrittenArgv);
    return { status: 'ok' };
  } catch (err: unknown) {
    if (isCommanderError(err)) {
      emitHeadlessCommanderUsageError({
        err,
        headlessDetection: context.headlessDetection,
      });
      if (shouldExitCommanderError(err)) {
        process.exit(getCommanderErrorExitCode(err));
        return { status: 'exited' };
      }
      return { status: 'ok' };
    }
    reportCliCrash(err);
    return { status: 'crash-reported' };
  }
}
