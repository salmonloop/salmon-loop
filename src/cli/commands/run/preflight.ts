import { spawnSync } from 'child_process';

import chalk from 'chalk';

import { logger } from '../../../core/observability/logger.js';
import { PluginLoader } from '../../../core/plugin/loader.js';
import {
  detectNodeRuntimeProfile,
  resolveScriptCommand,
} from '../../../core/target-runtime/index.js';
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
    const printable = [params.cmd, ...params.args].join(' ');
    throw new Error(`Command failed (${printable}) with exit code ${result.status}`);
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

  const profile = await detectNodeRuntimeProfile(params.repoPath);
  if (!profile) {
    logger.warn(text.cli.validationSkippedNoPackageJson);
    return;
  }

  const lintCommand = resolveScriptCommand(profile, 'lint');
  const testCommand = resolveScriptCommand(profile, 'test');
  if (!lintCommand && !testCommand) {
    logger.warn(text.cli.validationSkippedNoScripts);
    return;
  }

  logger.debug(text.cli.validationUsingPackageManager(profile.packageManager));
  try {
    if (lintCommand) {
      logger.debug(text.cli.runningScript('lint', lintCommand.shellCommand));
      runValidateCommand({
        repoPath: params.repoPath,
        cmd: lintCommand.command,
        args: lintCommand.args,
        useGui: params.useGui,
      });
    } else {
      logger.debug(text.cli.scriptMissing('lint'));
    }

    if (testCommand) {
      logger.debug(text.cli.runningScript('test', testCommand.shellCommand));
      try {
        runValidateCommand({
          repoPath: params.repoPath,
          cmd: testCommand.command,
          args: testCommand.args,
          useGui: params.useGui,
        });
      } catch {
        logger.warn(text.cli.testsFailedContinuing);
      }
    } else {
      logger.debug(text.cli.scriptMissing('test'));
    }

    logger.success(text.cli.validationCompleted);
  } catch {
    logger.error(text.cli.validationFailed, true);
  }
}
