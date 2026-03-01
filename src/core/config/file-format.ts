import { stringify as stringifyYaml } from 'yaml';

import { ConfigError } from './errors.js';

export type ConfigFileFormat = 'json' | 'yaml';

export function detectConfigFileFormat(configPath: string): ConfigFileFormat {
  const lower = configPath.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'json';
}

function snakeToCamel(key: string): string {
  if (!key.includes('_')) return key;
  return key.replace(/_([a-zA-Z0-9])/g, (_m, ch: string) => ch.toUpperCase());
}

function camelToSnake(key: string): string {
  if (!/[A-Z]/.test(key)) return key;
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathEndsWith(path: string[], segment: string): boolean {
  return path.length > 0 && path[path.length - 1] === segment;
}

function shouldPreserveMapKeys(path: string[]): boolean {
  const joined = path.join('.');
  if (joined === 'llm.providers') return true;
  if (joined === 'llm.models') return true;
  if (joined === 'llm.routing.taskToModel') return true;
  if (joined === 'llm.routing.phaseToModel') return true;
  if (joined === 'llm.routing.phaseToProviderModel') return true;
  if (pathEndsWith(path, 'headers')) return true;
  return false;
}

function convertYamlInputToInternal(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertYamlInputToInternal(item, path));
  }
  if (!isPlainObject(value)) return value;

  if (shouldPreserveMapKeys(path)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = convertYamlInputToInternal(v, [...path, k]);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const ck = snakeToCamel(k);
    out[ck] = convertYamlInputToInternal(v, [...path, ck]);
  }
  return out;
}

function convertInternalToYamlOutput(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertInternalToYamlOutput(item, path));
  }
  if (!isPlainObject(value)) return value;

  if (shouldPreserveMapKeys(path)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = convertInternalToYamlOutput(v, [...path, k]);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const sk = camelToSnake(k);
    out[sk] = convertInternalToYamlOutput(v, [...path, k]);
  }
  return out;
}

export function parseConfigText(raw: string, configPath: string): unknown {
  const format = detectConfigFileFormat(configPath);
  try {
    if (format === 'yaml') {
      const parsed = Bun.YAML.parse(raw);
      return convertYamlInputToInternal(parsed);
    }
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigError('CONFIG_PARSE_FAILED', {
      path: configPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function stringifyConfigText(value: unknown, format: ConfigFileFormat): string {
  if (format === 'yaml') {
    const yamlShape = convertInternalToYamlOutput(value);
    return stringifyYaml(yamlShape, {
      collectionStyle: 'block',
      indent: 2,
      lineWidth: 0,
    });
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}
