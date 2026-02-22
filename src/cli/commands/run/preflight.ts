import chalk from 'chalk';

import { logger } from '../../../core/observability/logger.js';
import { PluginLoader } from '../../../core/plugin/loader.js';
import { spawnCommand } from '../../../core/runtime/process-runner.js';
import {
  detectNodeRuntimeProfile,
  resolveScriptCommand,
} from '../../../core/target-runtime/index.js';
import { text } from '../../locales/index.js';

async function runValidateCommand(params: {
  repoPath: string;
  cmd: string;
  args: string[];
  useGui: boolean;
}) {
  const maxBytesPerStream = 500_000;
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;

  const result = await spawnCommand({
    command: params.cmd,
    args: params.args,
    cwd: params.repoPath,
    windowsHide: true,
    onStdoutChunk: (chunk) => {
      if (stdoutBytes >= maxBytesPerStream) return;
      const buffer = Buffer.from(chunk);
      const remaining = maxBytesPerStream - stdoutBytes;
      if (buffer.length <= remaining) {
        stdout += buffer.toString('utf-8');
        stdoutBytes += buffer.length;
        return;
      }
      stdout += buffer.subarray(0, remaining).toString('utf-8');
      stdoutBytes += remaining;
    },
    onStderrChunk: (chunk) => {
      if (stderrBytes >= maxBytesPerStream) return;
      const buffer = Buffer.from(chunk);
      const remaining = maxBytesPerStream - stderrBytes;
      if (buffer.length <= remaining) {
        stderr += buffer.toString('utf-8');
        stderrBytes += buffer.length;
        return;
      }
      stderr += buffer.subarray(0, remaining).toString('utf-8');
      stderrBytes += remaining;
    },
  });

  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim();

  if (combined) {
    const output = params.useGui ? combined.slice(0, 2_000) : combined;
    logger.log(output);
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.timedOut) {
    const printable = [params.cmd, ...params.args].join(' ');
    throw new Error(`Command failed (${printable}) due to timeout`);
  }

  if (result.code !== 0) {
    const printable = [params.cmd, ...params.args].join(' ');
    throw new Error(`Command failed (${printable}) with exit code ${String(result.code)}`);
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
      await runValidateCommand({
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
        await runValidateCommand({
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
