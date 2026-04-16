import { readFile } from '../adapters/fs/node-fs.js';

import { ConfigError } from './errors.js';
import { parseConfigText } from './file-format.js';
import {
  getDefaultRepoConfigPaths,
  getDefaultUserConfigPaths,
  resolveConfigPath,
} from './paths.js';
import type { ConfigFileV1 } from './types.js';
import { validateConfigFileV1 } from './validate.js';

export interface LoadConfigOptions {
  repoRoot: string;
  configPath?: string;
  enabled: boolean;
  required?: boolean;
}

export interface LoadedConfig {
  path: string;
  config: ConfigFileV1;
}

export interface LoadedConfigStack {
  repo?: LoadedConfig;
  user?: LoadedConfig;
}

async function loadFromCandidates(
  candidatePaths: string[],
  required: boolean | undefined,
): Promise<LoadedConfig | null> {
  for (let i = 0; i < candidatePaths.length; i++) {
    const absPath = candidatePaths[i];
    try {
      const raw = await readFile(absPath, 'utf8');
      const parsed = parseConfigText(raw, absPath);
      const config = validateConfigFileV1(parsed);
      return { path: absPath, config };
    } catch (e: unknown) {
      if (
        (e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined) ===
        'ENOENT'
      ) {
        const isLast = i === candidatePaths.length - 1;
        if (required && isLast) {
          throw new ConfigError('CONFIG_FILE_NOT_FOUND', { path: absPath });
        }
        continue;
      }
      throw e;
    }
  }

  return null;
}

export async function tryLoadConfigFile(opts: LoadConfigOptions): Promise<LoadedConfig | null> {
  if (!opts.enabled) return null;

  const candidatePaths = opts.configPath
    ? [resolveConfigPath(opts.repoRoot, opts.configPath)]
    : getDefaultRepoConfigPaths(opts.repoRoot);

  return loadFromCandidates(candidatePaths, opts.required);
}

export async function loadConfigStack(opts: LoadConfigOptions): Promise<LoadedConfigStack> {
  if (!opts.enabled) return {};

  if (opts.configPath) {
    const loaded = await tryLoadConfigFile(opts);
    return loaded ? { repo: loaded } : {};
  }

  const repo = await loadFromCandidates(getDefaultRepoConfigPaths(opts.repoRoot), false);
  const user = await loadFromCandidates(getDefaultUserConfigPaths(), false);
  return { repo: repo ?? undefined, user: user ?? undefined };
}
