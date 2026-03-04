import chalk from 'chalk';
import { Command } from 'commander';

import { initializeRuntime } from '../core/facades/cli-program-bootstrap.js';

import { text } from './locales/index.js';

export function bootstrapProgram(): Command {
  initializeRuntime();

  // Force global chalk level for all output paths.
  chalk.level = 3;

  const program = new Command();
  program.exitOverride();
  program.name('s8p').alias('salmonloop').description(text.cli.programDescription).version('0.2.0');
  return program;
}
