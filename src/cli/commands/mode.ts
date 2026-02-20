import { FileAdapter } from '../../core/adapters/fs/index.js';
import { ConfigError } from '../../core/config/index.js';
import { getDefaultRepoConfigPath } from '../../core/config/paths.js';
import { normalizeUiLogMode, type UiLogMode } from '../../core/config/types.js';
import { validateConfigFileV1 } from '../../core/config/validate.js';
import { sanitizeError } from '../../core/llm/errors.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

const LOG_MODE_SUGGESTIONS: UiLogMode[] = ['quiet', 'normal', 'debug'];

async function readUiLogModeFromConfig(repoRoot: string): Promise<UiLogMode | undefined> {
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
  return validated.ui?.log?.mode;
}

async function persistUiLogMode(repoRoot: string, mode: UiLogMode) {
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
      mode,
    },
  };

  await fileAdapter.writeFile(configPath, JSON.stringify(baseConfig, null, 2) + '\n');
  return configPath;
}

export const modeCommand: Command = {
  name: '/mode',
  description: text.cli.commandMode,
  order: 54,
  hidden: true,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    if (argIndex !== 1) return [];
    const search = currentPrefix.toLowerCase();
    return LOG_MODE_SUGGESTIONS.filter((m) => m.startsWith(search)).map((m) => ({
      name: m,
      description: text.cli.modeSuggestion(m),
    }));
  },
  execute: async ({ emit, input, sessionManager, dispatch }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const rawValue = args[0];
    const repoRoot = sessionManager.getCurrent().meta.repoPath;

    if (!rawValue) {
      try {
        const current = (await readUiLogModeFromConfig(repoRoot)) ?? 'normal';
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.modeCurrent(current),
          timestamp: new Date(),
        });
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.modeUsage,
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
          message: text.cli.modePersistFailed(message),
          timestamp: new Date(),
        });
        return;
      }
    }

    const normalized = normalizeUiLogMode(rawValue);
    if (!normalized) {
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.modeInvalid(rawValue),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.modeUsage,
        timestamp: new Date(),
      });
      return;
    }

    try {
      const configPath = await persistUiLogMode(repoRoot, normalized);
      dispatch?.({ type: 'SET_LOG_MODE', payload: normalized });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.modeUpdated(normalized),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.modePersisted(configPath),
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
        message: text.cli.modePersistFailed(message),
        timestamp: new Date(),
      });
    }
  },
};
