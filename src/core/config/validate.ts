import { LLM_OUTPUT_KINDS } from '../types/index.js';

import { ConfigError } from './errors.js';
import {
  MARKDOWN_RENDER_MODES,
  MARKDOWN_THEMES,
  type ConfigFileV1,
  normalizeUiLogMode,
  normalizeUiLogView,
  type LangfuseObservabilityConfigV1,
  type LlmModelProfileV1,
  type LlmProviderV1,
} from './types.js';

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

function isValidLlmOutputKind(value: unknown): boolean {
  return typeof value === 'string' && (LLM_OUTPUT_KINDS as readonly string[]).includes(value);
}

function isValidMarkdownTheme(value: unknown): boolean {
  return typeof value === 'string' && (MARKDOWN_THEMES as readonly string[]).includes(value);
}

function isValidMarkdownRenderMode(value: unknown): boolean {
  return typeof value === 'string' && (MARKDOWN_RENDER_MODES as readonly string[]).includes(value);
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

  if (input.observability !== undefined) {
    if (!isRecord(input.observability)) {
      throw new ConfigError('CONFIG_INVALID_OBSERVABILITY', { expected: 'object' });
    }
    const obs = input.observability;
    cfg.observability = {};

    if (obs.langfuse !== undefined) {
      if (!isRecord(obs.langfuse)) {
        throw new ConfigError('CONFIG_INVALID_OBSERVABILITY_LANGFUSE', { expected: 'object' });
      }
      const lf = obs.langfuse as Record<string, unknown>;
      const out: LangfuseObservabilityConfigV1 = {};
      if (lf.enabled !== undefined && !isBoolean(lf.enabled)) {
        throw new ConfigError('CONFIG_INVALID_LANGFUSE_ENABLED', { expected: 'boolean' });
      }
      if (lf.outcome !== undefined && !isBoolean(lf.outcome)) {
        throw new ConfigError('CONFIG_INVALID_LANGFUSE_OUTCOME', { expected: 'boolean' });
      }
      if (lf.endpoint !== undefined && !isString(lf.endpoint)) {
        throw new ConfigError('CONFIG_INVALID_LANGFUSE_ENDPOINT', { expected: 'string' });
      }
      if (lf.sessionId !== undefined && !isString(lf.sessionId)) {
        throw new ConfigError('CONFIG_INVALID_LANGFUSE_SESSION_ID', { expected: 'string' });
      }
      if (lf.userId !== undefined && !isString(lf.userId)) {
        throw new ConfigError('CONFIG_INVALID_LANGFUSE_USER_ID', { expected: 'string' });
      }
      out.enabled = lf.enabled as any;
      out.outcome = lf.outcome as any;
      out.endpoint = lf.endpoint as any;
      out.sessionId = lf.sessionId as any;
      out.userId = lf.userId as any;
      cfg.observability.langfuse = out;
    }
  }

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

  if ((input as any).ui !== undefined) {
    const uiRaw = (input as any).ui;
    if (!isRecord(uiRaw)) {
      throw new ConfigError('CONFIG_INVALID_UI', { expected: 'object' });
    }

    const ui: any = {};
    const logRaw = (uiRaw as any).log;
    if (logRaw !== undefined) {
      if (!isRecord(logRaw)) {
        throw new ConfigError('CONFIG_INVALID_UI_LOG', { expected: 'object' });
      }
      const viewRaw = (logRaw as any).view;
      const modeRaw = (logRaw as any).mode;
      if (viewRaw !== undefined) {
        if (!isString(viewRaw)) {
          throw new ConfigError('CONFIG_INVALID_UI_LOG_VIEW', { expected: 'string' });
        }
        const normalized = normalizeUiLogView(viewRaw);
        if (!normalized) {
          throw new ConfigError('CONFIG_INVALID_UI_LOG_VIEW', { view: String(viewRaw) });
        }
        ui.log = { ...(ui.log ?? {}), view: normalized };
      } else {
        ui.log = {};
      }

      if (modeRaw !== undefined) {
        if (!isString(modeRaw)) {
          throw new ConfigError('CONFIG_INVALID_UI_LOG_MODE', { expected: 'string' });
        }
        const normalized = normalizeUiLogMode(modeRaw);
        if (!normalized) {
          throw new ConfigError('CONFIG_INVALID_UI_LOG_MODE', { mode: String(modeRaw) });
        }
        ui.log = { ...(ui.log ?? {}), mode: normalized };
      }
    }

    cfg.ui = ui;
  }

  if ((input as any).context !== undefined) {
    const contextRaw = (input as any).context;
    if (!isRecord(contextRaw)) {
      throw new ConfigError('CONFIG_INVALID_CONTEXT', { expected: 'object' });
    }
    cfg.context = {};

    if (contextRaw.useTokenBudget !== undefined && !isBoolean(contextRaw.useTokenBudget)) {
      throw new ConfigError('CONFIG_INVALID_USE_TOKEN_BUDGET', { expected: 'boolean' });
    }
    if (contextRaw.useTokenBudget !== undefined) {
      cfg.context.useTokenBudget = contextRaw.useTokenBudget as any;
    }

    if (contextRaw.cache !== undefined) {
      if (!isRecord(contextRaw.cache)) {
        throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE', { expected: 'object' });
      }
      const cacheRaw = contextRaw.cache as Record<string, unknown>;
      const cache: NonNullable<ConfigFileV1['context']>['cache'] = {};
      if (
        cacheRaw.mode !== undefined &&
        cacheRaw.mode !== 'memory' &&
        cacheRaw.mode !== 'persistent'
      ) {
        throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_MODE', { mode: String(cacheRaw.mode) });
      }
      if (cacheRaw.path !== undefined && !isString(cacheRaw.path)) {
        throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_PATH', { expected: 'string' });
      }
      if (
        cacheRaw.allowedRoots !== undefined &&
        (!Array.isArray(cacheRaw.allowedRoots) || cacheRaw.allowedRoots.some((v) => !isString(v)))
      ) {
        throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS', {
          expected: 'string[]',
        });
      }
      if (cacheRaw.maxEntries !== undefined && !isNumber(cacheRaw.maxEntries)) {
        throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_MAX_ENTRIES', { expected: 'number' });
      }
      if (cacheRaw.ttlMs !== undefined && !isNumber(cacheRaw.ttlMs)) {
        throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_TTL', { expected: 'number' });
      }
      if (cacheRaw.mode === 'persistent') {
        if (!isString(cacheRaw.path) || cacheRaw.path.length === 0) {
          throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_PATH', {
            expected: 'non-empty string',
          });
        }
        if (
          !Array.isArray(cacheRaw.allowedRoots) ||
          cacheRaw.allowedRoots.length === 0 ||
          cacheRaw.allowedRoots.some((v) => !isString(v) || v.length === 0)
        ) {
          throw new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS', {
            expected: 'non-empty string[]',
          });
        }
      }
      cache.mode = cacheRaw.mode as any;
      cache.path = cacheRaw.path as any;
      cache.allowedRoots = cacheRaw.allowedRoots as any;
      cache.maxEntries = cacheRaw.maxEntries as any;
      cache.ttlMs = cacheRaw.ttlMs as any;
      cfg.context.cache = cache;
    }

    if (contextRaw.churn !== undefined) {
      if (!isRecord(contextRaw.churn)) {
        throw new ConfigError('CONFIG_INVALID_CHURN', { expected: 'object' });
      }
      const churnRaw = contextRaw.churn as Record<string, unknown>;
      const churn: NonNullable<ConfigFileV1['context']>['churn'] = {};

      if (churnRaw.weight !== undefined) {
        if (!isRecord(churnRaw.weight)) {
          throw new ConfigError('CONFIG_INVALID_CHURN_WEIGHT', { expected: 'object' });
        }
        const weightRaw = churnRaw.weight as Record<string, unknown>;
        if (weightRaw.primary !== undefined && !isNumber(weightRaw.primary)) {
          throw new ConfigError('CONFIG_INVALID_CHURN_WEIGHT_PRIMARY', { expected: 'number' });
        }
        if (weightRaw.rerank !== undefined && !isNumber(weightRaw.rerank)) {
          throw new ConfigError('CONFIG_INVALID_CHURN_WEIGHT_RERANK', { expected: 'number' });
        }
        if (weightRaw.tiebreak !== undefined && !isNumber(weightRaw.tiebreak)) {
          throw new ConfigError('CONFIG_INVALID_CHURN_WEIGHT_TIEBREAK', { expected: 'number' });
        }
        churn.weight = {
          primary: weightRaw.primary as any,
          rerank: weightRaw.rerank as any,
          tiebreak: weightRaw.tiebreak as any,
        };
      }

      cfg.context.churn = churn;
    }

    if (contextRaw.dynamicBudget !== undefined) {
      if (!isRecord(contextRaw.dynamicBudget)) {
        throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET', { expected: 'object' });
      }
      const dynamicBudgetRaw = contextRaw.dynamicBudget as Record<string, unknown>;
      const dynamicBudget: NonNullable<ConfigFileV1['context']>['dynamicBudget'] = {};

      if (dynamicBudgetRaw.enabled !== undefined && !isBoolean(dynamicBudgetRaw.enabled)) {
        throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_ENABLED', { expected: 'boolean' });
      }
      if (dynamicBudgetRaw.minBudget !== undefined && !isNumber(dynamicBudgetRaw.minBudget)) {
        throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_MIN', { expected: 'number' });
      }
      if (dynamicBudgetRaw.maxBudget !== undefined && !isNumber(dynamicBudgetRaw.maxBudget)) {
        throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_MAX', { expected: 'number' });
      }
      if (
        dynamicBudgetRaw.adjustmentStep !== undefined &&
        !isNumber(dynamicBudgetRaw.adjustmentStep)
      ) {
        throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_STEP', { expected: 'number' });
      }

      dynamicBudget.enabled = dynamicBudgetRaw.enabled as any;
      dynamicBudget.minBudget = dynamicBudgetRaw.minBudget as any;
      dynamicBudget.maxBudget = dynamicBudgetRaw.maxBudget as any;
      dynamicBudget.adjustmentStep = dynamicBudgetRaw.adjustmentStep as any;

      if (dynamicBudgetRaw.alerts !== undefined) {
        if (!isRecord(dynamicBudgetRaw.alerts)) {
          throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_ALERTS', { expected: 'object' });
        }
        const alertsRaw = dynamicBudgetRaw.alerts as Record<string, unknown>;
        if (alertsRaw.truncationRateWarn !== undefined && !isNumber(alertsRaw.truncationRateWarn)) {
          throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_ALERT_TRUNCATION', {
            expected: 'number',
          });
        }
        if (
          alertsRaw.criticalDropRateWarn !== undefined &&
          !isNumber(alertsRaw.criticalDropRateWarn)
        ) {
          throw new ConfigError('CONFIG_INVALID_DYNAMIC_BUDGET_ALERT_CRITICAL_DROP', {
            expected: 'number',
          });
        }
        dynamicBudget.alerts = {
          truncationRateWarn: alertsRaw.truncationRateWarn as any,
          criticalDropRateWarn: alertsRaw.criticalDropRateWarn as any,
        };
      }

      cfg.context.dynamicBudget = dynamicBudget;
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

  if ((input as any).astValidation !== undefined) {
    const astValidationRaw = (input as any).astValidation;
    if (!isRecord(astValidationRaw)) {
      throw new ConfigError('CONFIG_INVALID_AST_VALIDATION', { expected: 'object' });
    }
    const strictnessRaw = (astValidationRaw as any).strictness;
    if (strictnessRaw !== undefined && strictnessRaw !== 'lenient' && strictnessRaw !== 'strict') {
      throw new ConfigError('CONFIG_INVALID_AST_VALIDATION_STRICTNESS', {
        strictness: String(strictnessRaw),
      });
    }
    cfg.astValidation = {
      strictness: strictnessRaw as any,
    };
  }

  if (input.llm !== undefined) {
    if (!isRecord(input.llm)) {
      throw new ConfigError('CONFIG_INVALID_LLM', { expected: 'object' });
    }
    cfg.llm = {};
    if (input.llm.activeModel !== undefined && !isString(input.llm.activeModel)) {
      throw new ConfigError('CONFIG_INVALID_LLM_ACTIVE_MODEL', { expected: 'string' });
    }
    if (input.llm.activeModel !== undefined) cfg.llm.activeModel = input.llm.activeModel;

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

        if ((rawProvider as any).models !== undefined) {
          throw new ConfigError('CONFIG_LLM_PROVIDER_MODELS_NOT_SUPPORTED', {
            provider: id,
            hint: 'use llm.models with provider references',
          });
        }

        cfg.llm.providers[id] = p;
      }
    }

    if (input.llm.models !== undefined) {
      if (!isRecord(input.llm.models)) {
        throw new ConfigError('CONFIG_INVALID_LLM_MODELS', { expected: 'object' });
      }
      cfg.llm.models = {};
      for (const [slot, rawModel] of Object.entries(input.llm.models)) {
        if (!isRecord(rawModel)) {
          throw new ConfigError('CONFIG_INVALID_LLM_MODEL_PROFILE', {
            model: slot,
            expected: 'object',
          });
        }
        const provider = (rawModel as any).provider;
        if (
          !isString(provider) &&
          !(Array.isArray(provider) && provider.length > 0 && provider.every(isString))
        ) {
          throw new ConfigError('CONFIG_INVALID_LLM_MODEL_PROVIDER', {
            model: slot,
            expected: 'string_or_non_empty_string_array',
          });
        }
        if (!isString((rawModel as any).id) || !(rawModel as any).id.trim()) {
          throw new ConfigError('CONFIG_INVALID_LLM_MODEL_ID', {
            model: slot,
            expected: 'non_empty_string',
          });
        }

        cfg.llm.models[slot] = {
          provider: provider as any,
          id: (rawModel as any).id,
          params: isRecord((rawModel as any).params)
            ? ((rawModel as any).params as LlmModelProfileV1['params'])
            : undefined,
        };
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
      if (r.phaseToModel !== undefined) {
        if (!isRecord(r.phaseToModel)) {
          throw new ConfigError('CONFIG_INVALID_PHASE_TO_MODEL', { expected: 'object' });
        }
        for (const [k, v] of Object.entries(r.phaseToModel)) {
          if (!isString(v)) {
            throw new ConfigError('CONFIG_INVALID_PHASE_TO_MODEL_VALUE', {
              phase: k,
              expected: 'string',
            });
          }
        }
        cfg.llm.routing.phaseToModel = r.phaseToModel as any;
      }
    }
  }

  if (input.output !== undefined) {
    if (!isRecord(input.output)) {
      throw new ConfigError('CONFIG_INVALID_OUTPUT', { expected: 'object' });
    }
    const output = input.output;
    cfg.output = {};
    if (output.llm !== undefined) {
      if (!isRecord(output.llm)) {
        throw new ConfigError('CONFIG_INVALID_LLM_OUTPUT', { expected: 'object' });
      }
      const llmOutput = output.llm;
      if (llmOutput.kinds !== undefined) {
        if (!Array.isArray(llmOutput.kinds) || !llmOutput.kinds.every(isString)) {
          throw new ConfigError('CONFIG_INVALID_LLM_OUTPUT_KINDS', { expected: 'string_array' });
        }
        const invalidKind = llmOutput.kinds.find((kind) => !isValidLlmOutputKind(kind));
        if (invalidKind) {
          throw new ConfigError('CONFIG_INVALID_LLM_OUTPUT_KIND', { kind: String(invalidKind) });
        }
      }
      cfg.output.llm = {
        kinds: llmOutput.kinds as any,
      };
    }
    if (output.markdown !== undefined) {
      if (!isRecord(output.markdown)) {
        throw new ConfigError('CONFIG_INVALID_OUTPUT_MARKDOWN', { expected: 'object' });
      }
      const markdown = output.markdown;
      if (markdown.theme !== undefined) {
        if (!isString(markdown.theme)) {
          throw new ConfigError('CONFIG_INVALID_MARKDOWN_THEME', { expected: 'string' });
        }
        if (!isValidMarkdownTheme(markdown.theme)) {
          throw new ConfigError('CONFIG_INVALID_MARKDOWN_THEME', { theme: String(markdown.theme) });
        }
      }
      if (markdown.mode !== undefined) {
        if (!isString(markdown.mode)) {
          throw new ConfigError('CONFIG_INVALID_MARKDOWN_RENDER_MODE', { expected: 'string' });
        }
        if (!isValidMarkdownRenderMode(markdown.mode)) {
          throw new ConfigError('CONFIG_INVALID_MARKDOWN_RENDER_MODE', {
            mode: String(markdown.mode),
          });
        }
      }
      cfg.output.markdown = {
        theme: markdown.theme as any,
        mode: markdown.mode as any,
      };
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
    if (t.nonInteractive !== undefined) {
      if (!isRecord(t.nonInteractive)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE', { expected: 'object' });
      }
      const ni = t.nonInteractive;
      if (ni.strategy !== undefined && !isString(ni.strategy)) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_STRATEGY', {
          expected: 'string',
        });
      }
      const strategy = (ni.strategy as any) ?? undefined;
      if (
        strategy !== undefined &&
        strategy !== 'deny' &&
        strategy !== 'command' &&
        strategy !== 'mcp'
      ) {
        throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_STRATEGY', {
          strategy: String(strategy),
        });
      }
      if (ni.command !== undefined) {
        if (!isRecord(ni.command)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_COMMAND', {
            expected: 'object',
          });
        }
        if (!isString(ni.command.cmd)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_COMMAND_CMD', {
            expected: 'string',
          });
        }
        if (ni.command.timeoutMs !== undefined && !isNumber(ni.command.timeoutMs)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_COMMAND_TIMEOUT', {
            expected: 'number',
          });
        }
      }
      if (ni.mcp !== undefined) {
        if (!isRecord(ni.mcp)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP', {
            expected: 'object',
          });
        }
        if (!isString(ni.mcp.server)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP_SERVER', {
            expected: 'string',
          });
        }
        if (!isString(ni.mcp.tool)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP_TOOL', {
            expected: 'string',
          });
        }
        if (ni.mcp.timeoutMs !== undefined && !isNumber(ni.mcp.timeoutMs)) {
          throw new ConfigError('CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP_TIMEOUT', {
            expected: 'number',
          });
        }
      }
      cfg.toolAuthorization.nonInteractive = {
        strategy: strategy as any,
        command: ni.command as any,
        mcp: ni.mcp as any,
      };
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
