#!/usr/bin/env bun
// 1. MUST be the very first lines to force all chalk instances (even in node_modules)
// to use color support before they complete initialization.
process.env.FORCE_COLOR = '3';

import 'dotenv/config';
import chalk from 'chalk';
import { Command } from 'commander';

import { initializeRuntime } from '../core/runtime/initialize.js';

import { detectHeadlessOutputFromArgv } from './argv/headless-detection.js';
import { rewriteArgvForPrintMode } from './argv/print-mode.js';
import { text } from './locales/index.js';
import { registerProgramCommands } from './program-commands.js';
import { configureProgramOutputForHeadless, parseProgramOrExit } from './program-parse.js';

// --- Global Safety Initialization ---
initializeRuntime();

// Force global chalk level
chalk.level = 3;

const program = new Command();

// --- Framework Error Hardening ---
// Prevent Commander from printing raw errors directly to terminal
program.exitOverride();

program.name('s8p').alias('salmonloop').description(text.cli.programDescription).version('0.2.0');

// --- Global Options ---
program
  .option('-r, --repo <path>', text.cli.repoOption, process.cwd())
  .option('-p, --print <instruction>', text.cli.printOption)
  .option('--continue', text.cli.continueOption)
  .option('--resume <sessionId>', text.cli.resumeOption)
  .option('-v, --verify <command>', text.cli.verifyOption)
  .option('--no-verify', 'Disable verification')
  .option('-cs, --checkpoint-strategy <type>', text.cli.checkpointStrategyOption, 'worktree')
  .option('--mode <mode>', text.cli.permissionModeOption, 'interactive')
  .option('--llm-output <kinds>', text.cli.llmOutputOption)
  .option('--audit-scope <scope>', text.cli.auditScopeOption);

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
