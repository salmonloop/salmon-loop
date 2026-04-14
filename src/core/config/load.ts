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
  type CandidateLoadResult =
    | { ok: true; absPath: string; loaded: LoadedConfig }
    | { ok: false; absPath: string; error: unknown };

  const results: CandidateLoadResult[] = await Promise.all(
    candidatePaths.map(async (absPath) => {
      try {
        const raw = await readFile(absPath, 'utf8');
        const parsed = parseConfigText(raw, absPath);
        const config = validateConfigFileV1(parsed);
        return { ok: true, absPath, loaded: { path: absPath, config } };
      } catch (e: unknown) {
        return { ok: false, absPath, error: e };
      }
    }),
  );

  for (const [i, result] of results.entries()) {
    if (result.ok) {
      return result.loaded;
    }

    const code =
      result.error && typeof result.error === 'object' && 'code' in result.error
        ? (result.error as { code?: string }).code
        : undefined;
    if (code === 'ENOENT') {
      const isLast = i === results.length - 1;
      if (required && isLast) {
        throw new ConfigError('CONFIG_FILE_NOT_FOUND', { path: result.absPath });
      }
      continue;
    }
    throw result.error;
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
