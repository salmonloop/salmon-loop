import chalk from 'chalk';

import { getLogger } from '../../../core/facades/cli-observability.js';
import { PluginLoader } from '../../../core/plugin/loader.js';
import type { PluginRegistry } from '../../../core/plugin/registry.js';
import {
  ProcessFailure,
  ProcessFailureKind,
  spawnCommand,
} from '../../../core/runtime/process-runner.js';
import {
  detectNodeRuntimeProfile,
  resolveScriptCommand,
} from '../../../core/target-runtime/index.js';
import { text } from '../../locales/index.js';

export type PreflightPolicy = 'lenient' | 'strict';

interface PreflightFailureDetails {
  scriptName: 'lint' | 'test';
  command: string;
  args: string[];
  reason: ProcessFailureKind;
  message: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  code?: string;
}

class PreflightCommandError extends Error {
  constructor(public readonly details: PreflightFailureDetails) {
    super(details.message);
  }
}

function mapFailureDetails(
  scriptName: 'lint' | 'test',
  cmd: string,
  args: string[],
  failure: ProcessFailure,
): PreflightFailureDetails {
  return {
    scriptName,
    command: cmd,
    args,
    reason: failure.kind,
    message: failure.message,
    exitCode: failure.exitCode,
    signal: failure.signal,
    code: failure.code,
  };
}

function buildFailureMessage(details: PreflightFailureDetails): string {
  const printable = [details.command, ...details.args].join(' ');
  switch (details.reason) {
    case 'timeout':
      return text.cli.validationCommandTimeout(details.scriptName, printable);
    case 'spawn_error':
      if (details.code === 'ENOENT') {
        return text.cli.validationCommandNotFound(details.scriptName, printable);
      }
      if (details.code === 'OUTPUT_TRUNCATED') {
        return text.cli.validationCommandOutputExceeded(details.scriptName, printable);
      }
      return text.cli.validationCommandSpawnError(details.scriptName, printable, details.message);
    case 'nonzero_exit':
      return text.cli.validationCommandExitCode(
        details.scriptName,
        printable,
        details.exitCode ?? -1,
      );
    case 'aborted':
      return text.cli.validationCommandAborted(details.scriptName, printable);
    default:
      return text.cli.validationCommandSpawnError(details.scriptName, printable, details.message);
  }
}

async function runValidateCommand(params: {
  repoPath: string;
  scriptName: 'lint' | 'test';
  cmd: string;
  args: string[];
  useGui: boolean;
  headlessOutput?: boolean;
}) {
  const maxBytesPerStream = 500_000;
  const env = params.headlessOutput
    ? {
        ...process.env,
        NO_COLOR: process.env.NO_COLOR ?? '1',
        FORCE_COLOR: '0',
      }
    : process.env;

  const result = await spawnCommand({
    command: params.cmd,
    args: params.args,
    cwd: params.repoPath,
    env,
    windowsHide: true,
    maxStdoutBytes: maxBytesPerStream,
    maxStderrBytes: maxBytesPerStream,
  });

  const combined = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').trim();

  if (combined) {
    const output = params.useGui ? combined.slice(0, 2_000) : combined;
    getLogger().log(output);
  }

  if (result.failure) {
    throw new PreflightCommandError(
      mapFailureDetails(params.scriptName, params.cmd, params.args, result.failure),
    );
  }

  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new PreflightCommandError({
      scriptName: params.scriptName,
      command: params.cmd,
      args: params.args,
      reason: 'spawn_error',
      message: 'Validation output exceeded allowed size',
      code: 'OUTPUT_TRUNCATED',
    });
  }
}

export async function runPreflight(params: {
  languagePlugins: PluginRegistry;
  repoPath: string;
  validate: boolean;
  useGui: boolean;
  headlessOutput?: boolean;
  preflightPolicy?: PreflightPolicy;
}) {
  await PluginLoader.loadPlugins(params.languagePlugins, params.repoPath);

  if (!params.validate) return;
  const preflightPolicy = params.preflightPolicy ?? 'lenient';

  getLogger().log(chalk.blue(text.cli.runningValidation));

  const profile = await detectNodeRuntimeProfile(params.repoPath);
  if (!profile) {
    getLogger().warn(text.cli.validationSkippedNoPackageJson);
    return;
  }

  const lintCommand = resolveScriptCommand(profile, 'lint');
  const testCommand = resolveScriptCommand(profile, 'test');
  if (!lintCommand && !testCommand) {
    getLogger().warn(text.cli.validationSkippedNoScripts);
    return;
  }

  getLogger().debug(text.cli.validationUsingPackageManager(profile.packageManager));
  try {
    if (lintCommand) {
      getLogger().debug(text.cli.runningScript('lint', lintCommand.shellCommand));
      try {
        await runValidateCommand({
          repoPath: params.repoPath,
          scriptName: 'lint',
          cmd: lintCommand.command,
          args: lintCommand.args,
          useGui: params.useGui,
          headlessOutput: params.headlessOutput,
        });
      } catch (error) {
        if (error instanceof PreflightCommandError) {
          getLogger().audit('cli.preflight.command_failure', error.details, {
            source: 'cli',
            severity: 'low',
          });
          getLogger().error(buildFailureMessage(error.details));
        }
        throw error;
      }
    } else {
      getLogger().debug(text.cli.scriptMissing('lint'));
    }

    if (testCommand) {
      getLogger().debug(text.cli.runningScript('test', testCommand.shellCommand));
      try {
        await runValidateCommand({
          repoPath: params.repoPath,
          scriptName: 'test',
          cmd: testCommand.command,
          args: testCommand.args,
          useGui: params.useGui,
          headlessOutput: params.headlessOutput,
        });
      } catch (error) {
        if (error instanceof PreflightCommandError) {
          getLogger().audit('cli.preflight.command_failure', error.details, {
            source: 'cli',
            severity: 'low',
          });
          const detailedMessage = buildFailureMessage(error.details);
          if (preflightPolicy === 'strict') {
            getLogger().error(detailedMessage);
            throw error;
          }
          getLogger().warn(detailedMessage);
        }
        getLogger().warn(text.cli.testsFailedContinuing);
      }
    } else {
      getLogger().debug(text.cli.scriptMissing('test'));
    }

    getLogger().success(text.cli.validationCompleted);
  } catch {
    getLogger().error(text.cli.validationFailed, true);
  }
}
