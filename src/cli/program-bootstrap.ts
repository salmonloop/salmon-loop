import chalk from 'chalk';
import { Command } from 'commander';

import { initializeRuntime, PACKAGE_VERSION } from '../core/facades/cli-program-bootstrap.js';

import type { DetectedHeadlessOutput } from './argv/headless-detection.js';
import { text } from './locales/index.js';

export function bootstrapProgram(
  options: { headlessDetection?: DetectedHeadlessOutput } = {},
): Command {
  initializeRuntime();

  if (!options.headlessDetection?.outputFormat && process.env.NO_COLOR === undefined) {
    // Force global chalk level for interactive output paths.
    chalk.level = 3;
  } else {
    chalk.level = 0;
  }

  const program = new Command();
  program.exitOverride();
  program
    .name('s8p')
    .alias('salmonloop')
    .description(text.cli.programDescription)
    .version(PACKAGE_VERSION)
    .addHelpText('after', text.cli.programHelpFooter);
  return program;
}
