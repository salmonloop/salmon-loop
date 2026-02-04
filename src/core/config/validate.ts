import { ConfigError } from './errors.js';
import type { ConfigFileV1, LlmProviderV1 } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function validateConfigFileV1(input: unknown): ConfigFileV1 {
  if (!isRecord(input)) {
    throw new ConfigError('CONFIG_INVALID_ROOT', { expected: 'object' });
  }

  const version = input.version;
  if (version !== undefined && version !== 1) {
    throw new ConfigError('CONFIG_UNSUPPORTED', { version: String(version) });
  }

  const cfg: ConfigFileV1 = { version: 1 };

  if (input.cli !== undefined) {
    if (!isRecord(input.cli)) {
      throw new ConfigError('CONFIG_INVALID_CLI', { expected: 'object' });
    }
    if (input.cli.defaults !== undefined) {
      if (!isRecord(input.cli.defaults)) {
        throw new ConfigError('CONFIG_INVALID_CLI_DEFAULTS', { expected: 'object' });
      }
      cfg.cli = { defaults: {} };
      const d = input.cli.defaults;
      if (d.verbosity !== undefined && !isString(d.verbosity)) {
        throw new ConfigError('CONFIG_INVALID_VERBOSITY', { expected: 'string' });
      }
      if (d.strategy !== undefined && !isString(d.strategy)) {
        throw new ConfigError('CONFIG_INVALID_STRATEGY', { expected: 'string' });
      }
      if (d.dryRun !== undefined && !isBoolean(d.dryRun)) {
        throw new ConfigError('CONFIG_INVALID_DRY_RUN', { expected: 'boolean' });
      }
      cfg.cli.defaults = {
        verbosity: d.verbosity as any,
        strategy: d.strategy as any,
        dryRun: d.dryRun as any,
      };
    }
  }

  if (input.verify !== undefined) {
    if (!isRecord(input.verify)) {
      throw new ConfigError('CONFIG_INVALID_VERIFY', { expected: 'object' });
    }
    if (input.verify.command !== undefined && !isString(input.verify.command)) {
      throw new ConfigError('CONFIG_INVALID_VERIFY_COMMAND', { expected: 'string' });
    }
    if (input.verify.timeoutMs !== undefined && !isNumber(input.verify.timeoutMs)) {
      throw new ConfigError('CONFIG_INVALID_VERIFY_TIMEOUT', { expected: 'number' });
    }
    cfg.verify = { command: input.verify.command as any, timeoutMs: input.verify.timeoutMs as any };
  }

  if (input.llm !== undefined) {
    if (!isRecord(input.llm)) {
      throw new ConfigError('CONFIG_INVALID_LLM', { expected: 'object' });
    }
    cfg.llm = {};
    if (input.llm.active !== undefined && !isString(input.llm.active)) {
      throw new ConfigError('CONFIG_INVALID_LLM_ACTIVE', { expected: 'string' });
    }
    if (input.llm.active !== undefined) cfg.llm.active = input.llm.active;

    if (input.llm.providers !== undefined) {
      if (!isRecord(input.llm.providers)) {
        throw new ConfigError('CONFIG_INVALID_LLM_PROVIDERS', { expected: 'object' });
      }
      cfg.llm.providers = {};
      for (const [id, rawProvider] of Object.entries(input.llm.providers)) {
        if (!isRecord(rawProvider)) {
          throw new ConfigError('CONFIG_INVALID_PROVIDER', { provider: id, expected: 'object' });
        }
        const p: LlmProviderV1 = { type: String(rawProvider.type) as any };
        if (!isString(rawProvider.type)) {
          throw new ConfigError('CONFIG_INVALID_TYPE', { provider: id, expected: 'string' });
        }

        if (rawProvider.client !== undefined) {
          if (!isRecord(rawProvider.client)) {
            throw new ConfigError('CONFIG_INVALID_CLIENT', { provider: id, expected: 'object' });
          }
          if (rawProvider.client.package !== undefined && !isString(rawProvider.client.package)) {
            throw new ConfigError('CONFIG_INVALID_CLIENT_PACKAGE', {
              provider: id,
              expected: 'string',
            });
          }
          p.client = { package: rawProvider.client.package as any };
        }

        if (rawProvider.api !== undefined) {
          if (!isRecord(rawProvider.api)) {
            throw new ConfigError('CONFIG_INVALID_API', { provider: id, expected: 'object' });
          }
          const api = rawProvider.api;
          if (api.baseUrl !== undefined && !isString(api.baseUrl)) {
            throw new ConfigError('CONFIG_INVALID_BASE_URL', { provider: id, expected: 'string' });
          }
          if (api.apiKey !== undefined && api.apiKey !== null && !isString(api.apiKey)) {
            throw new ConfigError('CONFIG_INVALID_API_KEY', {
              provider: id,
              expected: 'string_or_null',
            });
          }
          if (api.timeoutMs !== undefined && !isNumber(api.timeoutMs)) {
            throw new ConfigError('CONFIG_INVALID_TIMEOUT', { provider: id, expected: 'number' });
          }
          if (api.headers !== undefined) {
            if (!isRecord(api.headers)) {
              throw new ConfigError('CONFIG_INVALID_HEADERS', { provider: id, expected: 'object' });
            }
            for (const [k, v] of Object.entries(api.headers)) {
              if (!isString(v)) {
                throw new ConfigError('CONFIG_INVALID_HEADER_VALUE', {
                  provider: id,
                  header: k,
                  expected: 'string',
                });
              }
            }
          }
          p.api = {
            baseUrl: api.baseUrl as any,
            apiKey: api.apiKey as any,
            timeoutMs: api.timeoutMs as any,
            headers: api.headers as any,
          };
        }

        if (rawProvider.models !== undefined) {
          if (!isRecord(rawProvider.models)) {
            throw new ConfigError('CONFIG_INVALID_MODELS', { provider: id, expected: 'object' });
          }
          p.models = {};
          for (const [slot, rawModel] of Object.entries(rawProvider.models)) {
            if (!isRecord(rawModel)) {
              throw new ConfigError('CONFIG_INVALID_MODEL', {
                provider: id,
                model: slot,
                expected: 'object',
              });
            }
            if (!isString(rawModel.id) || !rawModel.id.trim()) {
              throw new ConfigError('CONFIG_INVALID_MODEL_ID', {
                provider: id,
                model: slot,
                expected: 'non_empty_string',
              });
            }
            p.models[slot] = {
              id: rawModel.id,
              params: isRecord(rawModel.params) ? (rawModel.params as any) : undefined,
            };
          }
        }

        cfg.llm.providers[id] = p;
      }
    }

    if (input.llm.routing !== undefined) {
      if (!isRecord(input.llm.routing)) {
        throw new ConfigError('CONFIG_INVALID_ROUTING', { expected: 'object' });
      }
      const r = input.llm.routing;
      cfg.llm.routing = {};
      if (r.fallbackProviders !== undefined) {
        if (!Array.isArray(r.fallbackProviders) || !r.fallbackProviders.every(isString)) {
          throw new ConfigError('CONFIG_INVALID_FALLBACK_PROVIDERS', { expected: 'string_array' });
        }
        cfg.llm.routing.fallbackProviders = r.fallbackProviders;
      }
      if (r.taskToModel !== undefined) {
        if (!isRecord(r.taskToModel)) {
          throw new ConfigError('CONFIG_INVALID_TASK_TO_MODEL', { expected: 'object' });
        }
        for (const [k, v] of Object.entries(r.taskToModel)) {
          if (!isString(v)) {
            throw new ConfigError('CONFIG_INVALID_TASK_TO_MODEL_VALUE', {
              task: k,
              expected: 'string',
            });
          }
        }
        cfg.llm.routing.taskToModel = r.taskToModel as any;
      }
    }
  }

  if (input.toolAuthorization !== undefined) {
    if (!isRecord(input.toolAuthorization)) {
      throw new ConfigError('CONFIG_INVALID_TOOL_AUTH', { expected: 'object' });
    }
    cfg.toolAuthorization = {};
    const t = input.toolAuthorization;

    if (t.sessionTtlMs !== undefined && !isNumber(t.sessionTtlMs)) {
      throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_TTL', { expected: 'number' });
    }
    if (t.autoAllowRisk !== undefined) {
      if (!isRecord(t.autoAllowRisk)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_RISK', { expected: 'object' });
      }
      const r = t.autoAllowRisk;
      if (r.low !== undefined && !isBoolean(r.low)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_RISK_LOW', { expected: 'boolean' });
      }
      if (r.medium !== undefined && !isBoolean(r.medium)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_RISK_MEDIUM', { expected: 'boolean' });
      }
      if (r.high !== undefined && !isBoolean(r.high)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_RISK_HIGH', { expected: 'boolean' });
      }
      cfg.toolAuthorization.autoAllowRisk = {
        low: r.low as any,
        medium: r.medium as any,
        high: r.high as any,
      };
    }
    if (t.allowlist !== undefined) {
      if (!isRecord(t.allowlist)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_ALLOWLIST', { expected: 'object' });
      }
      const a = t.allowlist;
      if (a.repoFile !== undefined && !isString(a.repoFile)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_REPO_FILE', { expected: 'string' });
      }
      if (a.userFile !== undefined && !isString(a.userFile)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_USER_FILE', { expected: 'string' });
      }
      cfg.toolAuthorization.allowlist = {
        repoFile: a.repoFile as any,
        userFile: a.userFile as any,
      };
    }
    if (t.sessionTtlMs !== undefined) {
      cfg.toolAuthorization.sessionTtlMs = t.sessionTtlMs as any;
    }
  }

  return cfg;
}
