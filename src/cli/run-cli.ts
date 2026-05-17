import { createCliRuntimeContext, type CliRuntimeContext } from './cli-runtime-context.js';
import { detectHeadlessOutputFromArgv } from './argv/headless-detection.js';
import { bootstrapProgram } from './program-bootstrap.js';
import { registerProgramCommands } from './program-commands.js';
import { configureGlobalProgramOptions } from './program-options.js';
import { configureProgramOutputForHeadless } from './program-output-mode.js';
import { parseProgramOrExit } from './program-parse.js';

export function buildCliProgram(argv: string[] = process.argv) {
  const headlessDetection = detectHeadlessOutputFromArgv(argv);
  const program = bootstrapProgram({ headlessDetection });
  configureGlobalProgramOptions(program);
  registerProgramCommands(program);
  return program;
}

export function createCliContextFromArgv(argv: string[]): CliRuntimeContext {
  const program = buildCliProgram(argv);
  return createCliRuntimeContext(program, argv);
}

export async function executeCliContext(context: CliRuntimeContext): Promise<void> {
  configureProgramOutputForHeadless(context);
  await parseProgramOrExit(context);
}

export async function runCli(argv: string[]): Promise<void> {
  const context = createCliContextFromArgv(argv);
  await executeCliContext(context);
}
