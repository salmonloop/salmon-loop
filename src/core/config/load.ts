import { readFile } from 'fs/promises';

import { sanitizeError } from '../llm/errors.js';

import { ConfigError } from './errors.js';
import { resolveConfigPath } from './paths.js';
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

export async function tryLoadConfigFile(opts: LoadConfigOptions): Promise<LoadedConfig | null> {
  if (!opts.enabled) return null;

  if (!opts.configPath) {
    return null;
  }

  const absPath = resolveConfigPath(opts.repoRoot, opts.configPath);
  try {
    const raw = await readFile(absPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new ConfigError('CONFIG_PARSE_FAILED', { path: absPath, error: sanitizeError(e) });
    }

    const config = validateConfigFileV1(parsed);
    return { path: absPath, config };
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      if (opts.required) {
        throw new ConfigError('CONFIG_FILE_NOT_FOUND', { path: absPath });
      }
      return null;
    }
    throw e;
  }
}
