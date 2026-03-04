#!/usr/bin/env bun
// 1. MUST be the very first lines to force all chalk instances (even in node_modules)
// to use color support before they complete initialization.
process.env.FORCE_COLOR = '3';

import 'dotenv/config';

import { detectHeadlessOutputFromArgv } from './argv/headless-detection.js';
import { rewriteArgvForPrintMode } from './argv/print-mode.js';
import { bootstrapProgram } from './program-bootstrap.js';
import { registerProgramCommands } from './program-commands.js';
import { configureGlobalProgramOptions } from './program-options.js';
import { configureProgramOutputForHeadless, parseProgramOrExit } from './program-parse.js';
const program = bootstrapProgram();
configureGlobalProgramOptions(program);
registerProgramCommands(program);

// Parse arguments with manual error handling
const rewrittenArgv = rewriteArgvForPrintMode(process.argv);
const headlessDetection = detectHeadlessOutputFromArgv(rewrittenArgv);
configureProgramOutputForHeadless(program, headlessDetection);
await parseProgramOrExit({
  program,
  argv: rewrittenArgv,
  headlessDetection,
});
