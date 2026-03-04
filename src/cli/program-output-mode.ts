import type { CliRuntimeContext } from './cli-runtime-context.js';

export function configureProgramOutputForHeadless(context: CliRuntimeContext): void {
  if (!context.headlessDetection.outputFormat) return;
  context.program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  context.program.showHelpAfterError(false);
  context.program.showSuggestionAfterError(false);
}
