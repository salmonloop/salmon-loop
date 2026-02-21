import { spawnSync } from 'child_process';

import chalk from 'chalk';

import { logger } from '../../../core/observability/logger.js';
import { PluginLoader } from '../../../core/plugin/loader.js';
import { text } from '../../locales/index.js';

function runValidateCommand(params: {
  repoPath: string;
  cmd: string;
  args: string[];
  useGui: boolean;
}) {
  const result = spawnSync(params.cmd, params.args, {
    cwd: params.repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    maxBuffer: 500_000,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();

  if (combined) {
    const output = params.useGui ? combined.slice(0, 2_000) : combined;
    logger.log(output);
  }

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}`);
  }
}

export async function runPreflight(params: {
  repoPath: string;
  validate: boolean;
  useGui: boolean;
}) {
  await PluginLoader.loadPlugins(params.repoPath);

  if (!params.validate) return;

  logger.log(chalk.blue(text.cli.runningValidation));
  try {
    logger.debug(text.cli.runningEslint);
    runValidateCommand({
      repoPath: params.repoPath,
      cmd: 'npx',
      args: ['eslint', 'src', '--ext', '.ts'],
      useGui: params.useGui,
    });
    logger.debug(text.cli.runningTests);
    try {
      runValidateCommand({
        repoPath: params.repoPath,
        cmd: 'npm',
        args: ['test'],
        useGui: params.useGui,
      });
    } catch {
      logger.warn(text.cli.testsFailedContinuing);
    }
    logger.success(text.cli.validationCompleted);
  } catch {
    logger.error(text.cli.validationFailed, true);
  }
}
