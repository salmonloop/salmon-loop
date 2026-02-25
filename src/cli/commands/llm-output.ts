import { FileAdapter } from '../../core/adapters/fs/index.js';
import {
  detectConfigFileFormat,
  parseConfigText,
  stringifyConfigText,
} from '../../core/config/file-format.js';
import { ConfigError } from '../../core/config/index.js';
import { getDefaultRepoConfigPaths } from '../../core/config/paths.js';
import { validateConfigFileV1 } from '../../core/config/validate.js';
import { sanitizeError } from '../../core/llm/errors.js';
import { resolveLlmOutputPolicy, DEFAULT_LLM_OUTPUT_POLICY } from '../../core/llm/output-policy.js';
import { LLM_OUTPUT_KINDS, type LlmOutputKind } from '../../core/types/index.js';
import { text } from '../locales/index.js';
import { parseLlmOutputKinds } from '../utils/llm-output.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

const OUTPUT_SUGGESTIONS = ['none', 'all', ...LLM_OUTPUT_KINDS];

function formatKinds(kinds: string[]): string {
  if (kinds.length === 0) return 'none';
  return kinds.join(', ');
}

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

async function persistLlmOutputKinds(repoRoot: string, kinds: LlmOutputKind[]) {
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

  baseConfig.output = {
    ...(baseConfig.output ?? {}),
    llm: {
      ...(baseConfig.output?.llm ?? {}),
      kinds,
    },
  };

  const format = detectConfigFileFormat(configPath);
  await fileAdapter.writeFile(configPath, stringifyConfigText(baseConfig, format));
  return configPath;
}

export const llmOutputCommand: Command = {
  name: '/output',
  description: text.cli.commandLlmOutput,
  aliases: ['/llm-output'],
  order: 60,
  hidden: true,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    if (argIndex !== 1) return [];
    const search = currentPrefix.toLowerCase();
    return OUTPUT_SUGGESTIONS.filter((kind) => kind.startsWith(search)).map((kind) => ({
      name: kind,
      description: text.cli.llmOutputSuggestion(kind),
    }));
  },
  execute: async ({ emit, input, getLlmOutputPolicy, setLlmOutputPolicy, sessionManager }) => {
    if (!setLlmOutputPolicy) {
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.llmOutputUnavailable,
        timestamp: new Date(),
      });
      return;
    }

    const args = input.trim().split(/\s+/).slice(1);
    const raw = args.join(' ').trim();
    const current = getLlmOutputPolicy?.() ?? DEFAULT_LLM_OUTPUT_POLICY;

    if (!raw) {
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.llmOutputCurrent(formatKinds(current.kinds)),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.llmOutputUsage,
        timestamp: new Date(),
      });
      return;
    }

    const parsed = parseLlmOutputKinds(raw);
    if (!parsed.ok) {
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.invalidLlmOutputKind(parsed.invalid),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.llmOutputUsage,
        timestamp: new Date(),
      });
      return;
    }

    const policy = resolveLlmOutputPolicy({ kinds: parsed.kinds });

    try {
      const repoRoot = sessionManager.getCurrent().meta.repoPath;
      const configPath = await persistLlmOutputKinds(repoRoot, policy.kinds);
      setLlmOutputPolicy(policy);
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.llmOutputUpdated(formatKinds(policy.kinds)),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.llmOutputPersisted(configPath),
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
        message: text.cli.llmOutputPersistFailed(message),
        timestamp: new Date(),
      });
    }
  },
};
