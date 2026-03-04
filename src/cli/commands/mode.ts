import {
  ConfigError,
  detectConfigFileFormat,
  FileAdapter,
  getDefaultRepoConfigPaths,
  normalizePermissionMode,
  parseConfigText,
  sanitizeError,
  stringifyConfigText,
  type PermissionMode,
  validateConfigFileV1,
} from '../../core/facades/cli-command-config.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

const MODE_SUGGESTIONS: PermissionMode[] = ['interactive', 'yolo'];

async function resolveConfigPathForReadWrite(
  fileAdapter: FileAdapter,
  repoRoot: string,
): Promise<string> {
  const candidates = getDefaultRepoConfigPaths(repoRoot);
  for (const p of candidates) {
    if (await fileAdapter.exists(p)) return p;
  }
  return candidates[0];
}

async function readPermissionModeFromConfig(repoRoot: string): Promise<PermissionMode | undefined> {
  const fileAdapter = new FileAdapter();
  const configPath = await resolveConfigPathForReadWrite(fileAdapter, repoRoot);
  const exists = await fileAdapter.exists(configPath);
  if (!exists) return undefined;
  const raw = await fileAdapter.readFile(configPath);
  const parsed = parseConfigText(raw, configPath);
  const validated = validateConfigFileV1(parsed);
  return normalizePermissionMode(validated.mode);
}

async function persistPermissionMode(repoRoot: string, mode: PermissionMode) {
  const fileAdapter = new FileAdapter();
  const configPath = await resolveConfigPathForReadWrite(fileAdapter, repoRoot);
  const exists = await fileAdapter.exists(configPath);
  let baseConfig: any = { version: 1 };

  if (exists) {
    const raw = await fileAdapter.readFile(configPath);
    const parsed = parseConfigText(raw, configPath);
    validateConfigFileV1(parsed);
    baseConfig = parsed;
  }

  if (!baseConfig.version) {
    baseConfig.version = 1;
  }
  baseConfig.mode = mode;

  const format = detectConfigFileFormat(configPath);
  await fileAdapter.writeFile(configPath, stringifyConfigText(baseConfig, format));
  return configPath;
}

export const modeCommand: Command = {
  name: '/mode',
  description: text.cli.commandMode,
  order: 53,
  hidden: true,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    if (argIndex !== 1) return [];
    const search = currentPrefix.toLowerCase();
    return MODE_SUGGESTIONS.filter((m) => m.startsWith(search)).map((m) => ({
      name: m,
      description: text.cli.modeSuggestion(m),
    }));
  },
  execute: async ({ emit, input, sessionManager }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const rawValue = args[0];
    const repoRoot = sessionManager.getCurrent().meta.repoPath;

    if (!rawValue) {
      try {
        const current = (await readPermissionModeFromConfig(repoRoot)) ?? 'interactive';
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

    const normalized = normalizePermissionMode(rawValue);
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
      const configPath = await persistPermissionMode(repoRoot, normalized);
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
