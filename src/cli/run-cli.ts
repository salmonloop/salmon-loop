import { createCliRuntimeContext } from './cli-runtime-context.js';
import { bootstrapProgram } from './program-bootstrap.js';
import { registerProgramCommands } from './program-commands.js';
import { configureGlobalProgramOptions } from './program-options.js';
import { configureProgramOutputForHeadless, parseProgramOrExit } from './program-parse.js';

export async function runCli(argv: string[]): Promise<void> {
  const program = bootstrapProgram();
  configureGlobalProgramOptions(program);
  registerProgramCommands(program);

  const context = createCliRuntimeContext(program, argv);
  configureProgramOutputForHeadless(context);
  await parseProgramOrExit(context);
}
