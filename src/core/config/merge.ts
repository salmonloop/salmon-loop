import type { ConfigFileV1 } from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeValues(userValue: unknown, repoValue: unknown): unknown {
  if (repoValue === undefined) return userValue;
  if (userValue === undefined) return repoValue;

  if (isPlainObject(userValue) && isPlainObject(repoValue)) {
    const merged: Record<string, unknown> = { ...userValue };
    for (const [key, value] of Object.entries(repoValue)) {
      merged[key] = mergeValues(userValue[key], value);
    }
    return merged;
  }

  return repoValue;
}

export function mergeConfigFiles(
  userConfig?: ConfigFileV1,
  repoConfig?: ConfigFileV1,
): ConfigFileV1 | undefined {
  if (!userConfig && !repoConfig) return undefined;
  if (!userConfig) return repoConfig;
  if (!repoConfig) return userConfig;
  return mergeValues(userConfig, repoConfig) as ConfigFileV1;
}
