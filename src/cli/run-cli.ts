import { detectHeadlessOutputFromArgv } from './argv/headless-detection.js';
import { rewriteArgvForPrintMode } from './argv/print-mode.js';
import { bootstrapProgram } from './program-bootstrap.js';
import { registerProgramCommands } from './program-commands.js';
import { configureGlobalProgramOptions } from './program-options.js';
import { configureProgramOutputForHeadless, parseProgramOrExit } from './program-parse.js';

export async function runCli(argv: string[]): Promise<void> {
  const program = bootstrapProgram();
  configureGlobalProgramOptions(program);
  registerProgramCommands(program);

  const rewrittenArgv = rewriteArgvForPrintMode(argv);
  const headlessDetection = detectHeadlessOutputFromArgv(rewrittenArgv);
  configureProgramOutputForHeadless(program, headlessDetection);
  await parseProgramOrExit({
    program,
    argv: rewrittenArgv,
    headlessDetection,
  });
}
