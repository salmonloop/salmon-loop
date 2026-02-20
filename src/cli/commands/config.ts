import { FileAdapter } from '../../core/adapters/fs/index.js';
import { ConfigError } from '../../core/config/index.js';
import { getDefaultRepoConfigPath } from '../../core/config/paths.js';
import { normalizeUiLogView, type UiLogView } from '../../core/config/types.js';
import { validateConfigFileV1 } from '../../core/config/validate.js';
import { sanitizeError } from '../../core/llm/errors.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

const LOG_VIEW_SUGGESTIONS: UiLogView[] = ['full', 'standard', 'compact'];

async function readUiLogViewFromConfig(repoRoot: string): Promise<UiLogView | undefined> {
  const fileAdapter = new FileAdapter();
  const configPath = getDefaultRepoConfigPath(repoRoot);
  const exists = await fileAdapter.exists(configPath);
  if (!exists) return undefined;
  const raw = await fileAdapter.readFile(configPath);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError('CONFIG_PARSE_FAILED', {
      path: configPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const validated = validateConfigFileV1(parsed);
  return validated.ui?.log?.view;
}

async function persistUiLogView(repoRoot: string, view: UiLogView) {
  const fileAdapter = new FileAdapter();
  const configPath = getDefaultRepoConfigPath(repoRoot);
  const exists = await fileAdapter.exists(configPath);
  let baseConfig: any = { version: 1 };

  if (exists) {
    const raw = await fileAdapter.readFile(configPath);
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ConfigError('CONFIG_PARSE_FAILED', {
        path: configPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    validateConfigFileV1(parsed);
    baseConfig = parsed;
  }

  if (!baseConfig.version) {
    baseConfig.version = 1;
  }

  baseConfig.ui = {
    ...(baseConfig.ui ?? {}),
    log: {
      ...(baseConfig.ui?.log ?? {}),
      view,
    },
  };

  await fileAdapter.writeFile(configPath, JSON.stringify(baseConfig, null, 2) + '\n');
  return configPath;
}

const logSubcommand: Command = {
  name: 'log',
  description: text.cli.configLogDescription,
  usage: text.cli.configLogUsage,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    if (argIndex !== 2) return [];
    const search = currentPrefix.toLowerCase();
    return LOG_VIEW_SUGGESTIONS.filter((v) => v.startsWith(search)).map((v) => ({
      name: v,
      description: text.cli.configLogSuggestion(v),
    }));
  },
  execute: async ({ emit, input, sessionManager, dispatch }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const rawValue = args[1];

    const repoRoot = sessionManager.getCurrent().meta.repoPath;

    if (!rawValue) {
      try {
        const current = (await readUiLogViewFromConfig(repoRoot)) ?? 'standard';
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.configLogCurrent(current),
          timestamp: new Date(),
        });
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.configLogUsage,
          timestamp: new Date(),
        });
        return;
      } catch (error) {
        const message =
          error instanceof ConfigError
            ? text.config.error(error.code ?? 'CONFIG_INVALID_ROOT', error.details)
            : sanitizeError(error);
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.configLogPersistFailed(message),
          timestamp: new Date(),
        });
        return;
      }
    }

    const normalized = normalizeUiLogView(rawValue);
    if (!normalized) {
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.configLogInvalid(rawValue),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.configLogUsage,
        timestamp: new Date(),
      });
      return;
    }

    try {
      const configPath = await persistUiLogView(repoRoot, normalized);
      dispatch?.({ type: 'SET_LOG_VIEW', payload: normalized });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.configLogUpdated(normalized),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.configLogPersisted(configPath),
        timestamp: new Date(),
      });
    } catch (error) {
      const message =
        error instanceof ConfigError
          ? text.config.error(error.code ?? 'CONFIG_INVALID_ROOT', error.details)
          : sanitizeError(error);
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.configLogPersistFailed(message),
        timestamp: new Date(),
      });
    }
  },
};

export const configCommand: Command = {
  name: '/config',
  description: text.cli.commandConfig,
  order: 55,
  subcommands: [logSubcommand],
  execute: async (ctx) => {
    const { emit, input } = ctx;
    const args = input.trim().split(/\s+/).slice(1);
    if (args.length === 0) {
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.configUsage,
        timestamp: new Date(),
      });
      return;
    }

    const subCmdName = args[0].toLowerCase();
    const subCmd = [logSubcommand].find((c) => c.name === subCmdName);
    if (subCmd) {
      return subCmd.execute({ ...ctx, input: `/config ${args.join(' ')}` });
    }

    emit({
      type: 'log',
      level: 'error',
      message: text.cli.configUnknownSubcommand(subCmdName),
      timestamp: new Date(),
    });
    emit({
      type: 'log',
      level: 'info',
      message: text.cli.configUsage,
      timestamp: new Date(),
    });
  },
};
