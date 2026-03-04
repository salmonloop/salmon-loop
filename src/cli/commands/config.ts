import {
  ConfigError,
  detectConfigFileFormat,
  FileAdapter,
  getDefaultRepoConfigPaths,
  normalizeUiLogView,
  parseConfigText,
  sanitizeError,
  stringifyConfigText,
  type UiLogView,
  validateConfigFileV1,
} from '../../core/facades/cli-command-config.js';
import { text } from '../locales/index.js';

import { allowlistCommand } from './allowlist.js';
import { llmOutputCommand } from './llm-output.js';
import { logModeCommand } from './log-mode.js';
import { modeCommand } from './mode.js';
import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

const LOG_VIEW_SUGGESTIONS: UiLogView[] = ['full', 'standard', 'compact'];

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

function delegateInputToCommand(originalInput: string, targetCommand: string): string {
  const trimmed = originalInput.trimStart();
  const tokens = trimmed.split(/\s+/);
  const rest = tokens.slice(2).join(' ');
  const isSpaceTrailing = originalInput.endsWith(' ');
  const base = rest ? `${targetCommand} ${rest}` : targetCommand;
  return isSpaceTrailing ? `${base} ` : base;
}

async function readUiLogViewFromConfig(repoRoot: string): Promise<UiLogView | undefined> {
  const fileAdapter = new FileAdapter();
  const configPath = await resolveConfigPathForReadWrite(fileAdapter, repoRoot);
  const exists = await fileAdapter.exists(configPath);
  if (!exists) return undefined;
  const raw = await fileAdapter.readFile(configPath);
  const parsed = parseConfigText(raw, configPath);
  const validated = validateConfigFileV1(parsed);
  return validated.ui?.log?.view;
}

async function persistUiLogView(repoRoot: string, view: UiLogView) {
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

  baseConfig.ui = {
    ...(baseConfig.ui ?? {}),
    log: {
      ...(baseConfig.ui?.log ?? {}),
      view,
    },
  };

  const format = detectConfigFileFormat(configPath);
  await fileAdapter.writeFile(configPath, stringifyConfigText(baseConfig, format));
  return configPath;
}

const viewSubcommand: Command = {
  name: 'view',
  description: text.cli.configViewDescription,
  usage: text.cli.configViewUsage,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    if (argIndex !== 2) return [];
    const search = currentPrefix.toLowerCase();
    return LOG_VIEW_SUGGESTIONS.filter((v) => v.startsWith(search)).map((v) => ({
      name: v,
      description: text.cli.configViewSuggestion(v),
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
          message: text.cli.configViewCurrent(current),
          timestamp: new Date(),
        });
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.configViewUsage,
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
          message: text.cli.configViewPersistFailed(message),
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
        message: text.cli.configViewInvalid(rawValue),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.configViewUsage,
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
        message: text.cli.configViewUpdated(normalized),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.configViewPersisted(configPath),
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
        message: text.cli.configViewPersistFailed(message),
        timestamp: new Date(),
      });
    }
  },
};

const modeSubcommand: Command = {
  name: 'mode',
  description: text.cli.configModeDescription,
  usage: text.cli.configModeUsage,
  getSuggestions: (ctx) =>
    modeCommand.getSuggestions?.({ ...ctx, input: delegateInputToCommand(ctx.input, '/mode') }) ??
    [],
  execute: async (ctx) =>
    modeCommand.execute({ ...ctx, input: delegateInputToCommand(ctx.input, '/mode') }),
};

const logModeSubcommand: Command = {
  name: 'log-mode',
  aliases: ['log'],
  description: text.cli.configLogModeDescription,
  usage: text.cli.configLogModeUsage,
  getSuggestions: (ctx) =>
    logModeCommand.getSuggestions?.({
      ...ctx,
      input: delegateInputToCommand(ctx.input, '/log-mode'),
    }) ?? [],
  execute: async (ctx) =>
    logModeCommand.execute({ ...ctx, input: delegateInputToCommand(ctx.input, '/log-mode') }),
};

const outputSubcommand: Command = {
  name: 'output',
  description: text.cli.configOutputDescription,
  usage: text.cli.configOutputUsage,
  getSuggestions: (ctx) =>
    llmOutputCommand.getSuggestions?.({
      ...ctx,
      input: delegateInputToCommand(ctx.input, '/output'),
    }) ?? [],
  execute: async (ctx) =>
    llmOutputCommand.execute({ ...ctx, input: delegateInputToCommand(ctx.input, '/output') }),
};

const allowlistSubcommand: Command = {
  name: 'allowlist',
  aliases: ['auth'],
  description: text.cli.configAllowlistDescription,
  usage: text.cli.configAllowlistUsage,
  getSuggestions: (ctx) =>
    allowlistCommand.getSuggestions?.({
      ...ctx,
      input: delegateInputToCommand(ctx.input, '/allowlist'),
    }) ?? [],
  execute: async (ctx) =>
    allowlistCommand.execute({ ...ctx, input: delegateInputToCommand(ctx.input, '/allowlist') }),
};

function findSubcommand(root: Command, name: string): Command | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return (root.subcommands ?? []).find((c) => {
    if (c.name.toLowerCase() === needle) return true;
    return (c.aliases ?? []).some((a) => a.toLowerCase() === needle);
  });
}

const configSubcommands: Command[] = [
  modeSubcommand,
  logModeSubcommand,
  viewSubcommand,
  outputSubcommand,
  allowlistSubcommand,
];

export const configCommand: Command = {
  name: '/config',
  description: text.cli.commandConfig,
  order: 55,
  subcommands: configSubcommands,
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
    const subCmd = findSubcommand(configCommand, subCmdName);
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
