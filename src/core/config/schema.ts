import { z } from 'zod';

import { LLM_OUTPUT_KINDS } from '../types/index.js';

import { ConfigError } from './errors.js';
import { normalizePermissionMode, normalizeUiLogMode, normalizeUiLogView } from './normalize.js';
import { MARKDOWN_RENDER_MODES, MARKDOWN_THEMES, UI_LOG_MODES, UI_LOG_VIEWS } from './types.js';

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

const finiteNumber = z.number().refine(Number.isFinite, { message: 'Expected finite number' });
const stringArray = z.array(z.string());
const nullableString = z.string().nullable();

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

const langfuseSchema = z.object({
  enabled: z.boolean().optional(),
  outcome: z.boolean().optional(),
  endpoint: z.string().optional(),
  apiKey: nullableString.optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
});

const auditBufferSchema = z.object({
  maxEvents: finiteNumber.optional(),
  maxBytes: finiteNumber.optional(),
  droppedWarn: finiteNumber.optional(),
});

const auditScopeSchema = z.enum(['repo', 'user']);

const auditSchema = z.object({
  scope: auditScopeSchema.optional(),
  buffer: auditBufferSchema.optional(),
});

const observabilitySchema = z.object({
  langfuse: langfuseSchema.optional(),
  audit: auditSchema.optional(),
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const cliDefaultsSchema = z.object({
  verbosity: z.string().optional(),
  strategy: z.string().optional(),
  dryRun: z.boolean().optional(),
});

const cliSchema = z.object({
  defaults: cliDefaultsSchema.optional(),
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const serverA2aSchema = z.object({
  host: z.string().optional(),
  port: finiteNumber.optional(),
  tokens: stringArray.optional(),
});

const serverAcpSessionStoreSchema = z.object({
  maxEntries: finiteNumber.optional(),
  maxAgeMs: finiteNumber.optional(),
  historyMaxEntries: finiteNumber.optional(),
  lockStaleMs: finiteNumber.optional(),
  lockHeartbeatMs: finiteNumber.optional(),
});

const serverAcpCheckpointSchema = z.object({
  lockStaleMs: finiteNumber.optional(),
  lockHeartbeatMs: finiteNumber.optional(),
});

const serverAcpSchema = z.object({
  sessionStore: serverAcpSessionStoreSchema.optional(),
  checkpointManifest: serverAcpCheckpointSchema.optional(),
});

const serverSchema = z
  .object({
    a2a: serverA2aSchema.optional(),
    acp: serverAcpSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const contextCacheSchema = z
  .object({
    mode: z.enum(['memory', 'persistent']).optional(),
    path: z.string().optional(),
    allowedRoots: stringArray.optional(),
    strict: z.boolean().optional(),
    fallbackToMemoryOnFailure: z.boolean().optional(),
    maxEntries: finiteNumber.optional(),
    ttlMs: finiteNumber.optional(),
    maxPayloadBytes: finiteNumber.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'persistent') {
      if (typeof val.path !== 'string' || val.path.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['path'],
          params: {
            configErrorCode: 'CONFIG_INVALID_CONTEXT_CACHE_PATH',
            expected: 'non-empty string',
          },
        });
      }
      if (
        !Array.isArray(val.allowedRoots) ||
        val.allowedRoots.length === 0 ||
        val.allowedRoots.some((v) => typeof v !== 'string' || v.length === 0)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['allowedRoots'],
          params: {
            configErrorCode: 'CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS',
            expected: 'non-empty string[]',
          },
        });
      }
    }
  });

const contextChurnWeightSchema = z.object({
  primary: finiteNumber.optional(),
  rerank: finiteNumber.optional(),
  tiebreak: finiteNumber.optional(),
});

const contextChurnSchema = z.object({
  weight: contextChurnWeightSchema.optional(),
});

const contextDynamicBudgetAlertsSchema = z.object({
  truncationRateWarn: finiteNumber.optional(),
  criticalDropRateWarn: finiteNumber.optional(),
});

const contextDynamicBudgetSchema = z.object({
  enabled: z.boolean().optional(),
  minBudget: finiteNumber.optional(),
  maxBudget: finiteNumber.optional(),
  adjustmentStep: finiteNumber.optional(),
  alerts: contextDynamicBudgetAlertsSchema.optional(),
});

const contextSchema = z.object({
  useTokenBudget: z.boolean().optional(),
  cache: contextCacheSchema.optional(),
  churn: contextChurnSchema.optional(),
  dynamicBudget: contextDynamicBudgetSchema.optional(),
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const securityRedactionSchema = z.object({
  enabled: z.boolean().optional(),
  mark: z.string().optional(),
  maxDepth: finiteNumber.optional(),
  keyAllowlist: stringArray.optional(),
  keyDenylist: stringArray.optional(),
  patterns: stringArray.optional(),
  disableDefaults: z.boolean().optional(),
});

const securitySchema = z.object({
  redaction: securityRedactionSchema.optional(),
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const llmOutputKindSchema = z.enum([...LLM_OUTPUT_KINDS]);

const outputLlmSchema = z.object({
  kinds: z.array(llmOutputKindSchema).optional(),
});

const outputMarkdownSchema = z.object({
  theme: z.enum([...MARKDOWN_THEMES]).optional(),
  mode: z.enum([...MARKDOWN_RENDER_MODES]).optional(),
});

const outputSchema = z.object({
  llm: outputLlmSchema.optional(),
  markdown: outputMarkdownSchema.optional(),
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const uiLogSchema = z.object({
  view: z.preprocess((val) => normalizeUiLogView(val), z.enum([...UI_LOG_VIEWS])).optional(),
  mode: z.preprocess((val) => normalizeUiLogMode(val), z.enum([...UI_LOG_MODES])).optional(),
});

const uiSchema = z.object({
  log: uiLogSchema.optional(),
});

// ---------------------------------------------------------------------------
// Verify & AST
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  command: z.string().optional(),
  timeoutMs: finiteNumber.optional(),
});

const astValidationSchema = z.object({
  strictness: z.enum(['lenient', 'strict']).optional(),
});

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

const llmCapabilitiesSchema = z
  .object({
    toolCalling: z.boolean().optional(),
    responseFormatJsonObject: z.boolean().optional(),
    streaming: z.boolean().optional(),
  })
  .strict();

const CAPABILITY_KEYS = new Set([
  'capabilities',
  'toolCalling',
  'responseFormatJsonObject',
  'streaming',
]);

const llmModelParamsSchema = z
  .object({
    temperature: finiteNumber.optional(),
    maxTokens: finiteNumber.optional(),
    topP: finiteNumber.optional(),
    presencePenalty: finiteNumber.optional(),
    frequencyPenalty: finiteNumber.optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    for (const key of CAPABILITY_KEYS) {
      if (key in val && (val as Record<string, unknown>)[key] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          params: {
            configErrorCode: 'CONFIG_INVALID_LLM_CAPABILITY_LOCATION',
            capability: key,
            expected: 'model.capabilities',
          },
        });
      }
    }
  });

const modelProviderSchema = z.union([z.string(), z.array(z.string()).min(1)]);

const llmModelProfileSchema = z.object({
  provider: modelProviderSchema,
  id: z.string().min(1),
  params: llmModelParamsSchema.optional(),
  capabilities: llmCapabilitiesSchema.optional(),
});

const llmProviderApiSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: nullableString.optional(),
  timeoutMs: finiteNumber.optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const llmProviderClientSchema = z.object({
  package: z.string().optional(),
});

const llmProviderSchema = z
  .object({
    type: z.string(),
    client: llmProviderClientSchema.optional(),
    api: llmProviderApiSchema.optional(),
    capabilities: llmCapabilitiesSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if ('models' in val && (val as Record<string, unknown>).models !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['models'],
        params: {
          configErrorCode: 'CONFIG_LLM_PROVIDER_MODELS_NOT_SUPPORTED',
          hint: 'use llm.models with provider references',
        },
      });
    }
  });

const llmRoutingSchema = z.object({
  fallbackProviders: stringArray.optional(),
  taskToModel: z.record(z.string(), z.string()).optional(),
  phaseToModel: z.record(z.string(), z.string()).optional(),
});

const llmSchema = z.object({
  activeModel: z.string().optional(),
  simpleModel: z.string().optional(),
  mediumModel: z.string().optional(),
  complexModel: z.string().optional(),
  reasoningModel: z.string().optional(),
  providers: z.record(z.string(), llmProviderSchema).optional(),
  models: z.record(z.string(), llmModelProfileSchema).optional(),
  routing: llmRoutingSchema.optional(),
});

// ---------------------------------------------------------------------------
// Tool Authorization
// ---------------------------------------------------------------------------

const toolAuthNonInteractiveCmdSchema = z.object({
  cmd: z.string(),
  timeoutMs: finiteNumber.optional(),
});

const toolAuthNonInteractiveMcpSchema = z.object({
  server: z.string(),
  tool: z.string(),
  timeoutMs: finiteNumber.optional(),
});

const toolAuthNonInteractiveSchema = z.object({
  strategy: z.enum(['deny', 'command', 'mcp']).optional(),
  command: toolAuthNonInteractiveCmdSchema.optional(),
  mcp: toolAuthNonInteractiveMcpSchema.optional(),
});

const toolAuthAutoAllowRiskSchema = z.object({
  low: z.boolean().optional(),
  medium: z.boolean().optional(),
  high: z.boolean().optional(),
});

const toolAuthAllowlistSummarySchema = z.object({
  every: finiteNumber.optional(),
  minIntervalMs: finiteNumber.optional(),
  failureMinIntervalMs: finiteNumber.optional(),
  maxToolStats: finiteNumber.optional(),
  maxPathStats: finiteNumber.optional(),
});

const toolAuthAllowlistMatchingSchema = z.object({
  denySideEffects: z.enum(['any', 'all']).optional(),
  allowSideEffects: z.enum(['any', 'all']).optional(),
});

const toolAuthAllowlistSchema = z.object({
  repoFile: z.string().optional(),
  userFile: z.string().optional(),
  summary: toolAuthAllowlistSummarySchema.optional(),
  matching: toolAuthAllowlistMatchingSchema.optional(),
});

const toolAuthorizationSchema = z.object({
  sessionTtlMs: finiteNumber.optional(),
  autoAllowRisk: toolAuthAutoAllowRiskSchema.optional(),
  nonInteractive: toolAuthNonInteractiveSchema.optional(),
  allowlist: toolAuthAllowlistSchema.optional(),
});

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

export const configFileV1Schema = z
  .object({
    version: z.literal(1).optional(),
    mode: z
      .preprocess((val) => normalizePermissionMode(val), z.enum(['interactive', 'yolo']))
      .optional(),
    cli: cliSchema.optional(),
    server: serverSchema.optional(),
    context: contextSchema.optional(),
    observability: observabilitySchema.optional(),
    security: securitySchema.optional(),
    output: outputSchema.optional(),
    ui: uiSchema.optional(),
    verify: verifySchema.optional(),
    astValidation: astValidationSchema.optional(),
    llm: llmSchema.optional(),
    toolAuthorization: toolAuthorizationSchema.optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Error code mapping
// ---------------------------------------------------------------------------

const ERROR_CODE_MAP = new Map<string, string>([
  // Root
  ['version', 'CONFIG_UNSUPPORTED'],

  // Mode
  ['mode', 'CONFIG_INVALID_MODE'],

  // CLI
  ['cli', 'CONFIG_INVALID_CLI'],
  ['cli.defaults', 'CONFIG_INVALID_CLI_DEFAULTS'],
  ['cli.defaults.verbosity', 'CONFIG_INVALID_VERBOSITY'],
  ['cli.defaults.strategy', 'CONFIG_INVALID_STRATEGY'],
  ['cli.defaults.dryRun', 'CONFIG_INVALID_DRY_RUN'],

  // Server
  ['server', 'CONFIG_INVALID_SERVER'],
  ['server.a2a', 'CONFIG_INVALID_SERVER_A2A'],
  ['server.a2a.host', 'CONFIG_INVALID_SERVER_A2A_HOST'],
  ['server.a2a.port', 'CONFIG_INVALID_SERVER_A2A_PORT'],
  ['server.a2a.tokens', 'CONFIG_INVALID_SERVER_A2A_TOKENS'],
  ['server.acp', 'CONFIG_INVALID_SERVER_ACP'],
  ['server.acp.sessionStore', 'CONFIG_INVALID_SERVER_ACP_SESSION_STORE'],
  ['server.acp.sessionStore.maxEntries', 'CONFIG_INVALID_SERVER_ACP_SESSION_STORE_MAX_ENTRIES'],
  ['server.acp.sessionStore.maxAgeMs', 'CONFIG_INVALID_SERVER_ACP_SESSION_STORE_MAX_AGE_MS'],
  [
    'server.acp.sessionStore.historyMaxEntries',
    'CONFIG_INVALID_SERVER_ACP_SESSION_STORE_HISTORY_MAX_ENTRIES',
  ],
  ['server.acp.sessionStore.lockStaleMs', 'CONFIG_INVALID_SERVER_ACP_SESSION_STORE_LOCK_STALE_MS'],
  [
    'server.acp.sessionStore.lockHeartbeatMs',
    'CONFIG_INVALID_SERVER_ACP_SESSION_STORE_LOCK_HEARTBEAT_MS',
  ],
  ['server.acp.checkpointManifest', 'CONFIG_INVALID_SERVER_ACP_CHECKPOINT_MANIFEST'],
  [
    'server.acp.checkpointManifest.lockStaleMs',
    'CONFIG_INVALID_SERVER_ACP_CHECKPOINT_MANIFEST_LOCK_STALE_MS',
  ],
  [
    'server.acp.checkpointManifest.lockHeartbeatMs',
    'CONFIG_INVALID_SERVER_ACP_CHECKPOINT_MANIFEST_LOCK_HEARTBEAT_MS',
  ],

  // Context
  ['context', 'CONFIG_INVALID_CONTEXT'],
  ['context.useTokenBudget', 'CONFIG_INVALID_USE_TOKEN_BUDGET'],
  ['context.cache', 'CONFIG_INVALID_CONTEXT_CACHE'],
  ['context.cache.mode', 'CONFIG_INVALID_CONTEXT_CACHE_MODE'],
  ['context.cache.path', 'CONFIG_INVALID_CONTEXT_CACHE_PATH'],
  ['context.cache.allowedRoots', 'CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS'],
  ['context.cache.maxEntries', 'CONFIG_INVALID_CONTEXT_CACHE_MAX_ENTRIES'],
  ['context.cache.ttlMs', 'CONFIG_INVALID_CONTEXT_CACHE_TTL'],
  ['context.cache.maxPayloadBytes', 'CONFIG_INVALID_CONTEXT_CACHE_MAX_PAYLOAD'],
  ['context.churn', 'CONFIG_INVALID_CHURN'],
  ['context.churn.weight', 'CONFIG_INVALID_CHURN_WEIGHT'],
  ['context.churn.weight.primary', 'CONFIG_INVALID_CHURN_WEIGHT_PRIMARY'],
  ['context.churn.weight.rerank', 'CONFIG_INVALID_CHURN_WEIGHT_RERANK'],
  ['context.churn.weight.tiebreak', 'CONFIG_INVALID_CHURN_WEIGHT_TIEBREAK'],
  ['context.dynamicBudget', 'CONFIG_INVALID_DYNAMIC_BUDGET'],
  ['context.dynamicBudget.enabled', 'CONFIG_INVALID_DYNAMIC_BUDGET_ENABLED'],
  ['context.dynamicBudget.minBudget', 'CONFIG_INVALID_DYNAMIC_BUDGET_MIN'],
  ['context.dynamicBudget.maxBudget', 'CONFIG_INVALID_DYNAMIC_BUDGET_MAX'],
  ['context.dynamicBudget.adjustmentStep', 'CONFIG_INVALID_DYNAMIC_BUDGET_STEP'],
  ['context.dynamicBudget.alerts', 'CONFIG_INVALID_DYNAMIC_BUDGET_ALERTS'],
  [
    'context.dynamicBudget.alerts.truncationRateWarn',
    'CONFIG_INVALID_DYNAMIC_BUDGET_ALERT_TRUNCATION',
  ],
  [
    'context.dynamicBudget.alerts.criticalDropRateWarn',
    'CONFIG_INVALID_DYNAMIC_BUDGET_ALERT_CRITICAL_DROP',
  ],

  // Observability
  ['observability', 'CONFIG_INVALID_OBSERVABILITY'],
  ['observability.langfuse', 'CONFIG_INVALID_OBSERVABILITY_LANGFUSE'],
  ['observability.langfuse.enabled', 'CONFIG_INVALID_LANGFUSE_ENABLED'],
  ['observability.langfuse.outcome', 'CONFIG_INVALID_LANGFUSE_OUTCOME'],
  ['observability.langfuse.endpoint', 'CONFIG_INVALID_LANGFUSE_ENDPOINT'],
  ['observability.langfuse.apiKey', 'CONFIG_INVALID_LANGFUSE_API_KEY'],
  ['observability.langfuse.sessionId', 'CONFIG_INVALID_LANGFUSE_SESSION_ID'],
  ['observability.langfuse.userId', 'CONFIG_INVALID_LANGFUSE_USER_ID'],
  ['observability.audit', 'CONFIG_INVALID_OBSERVABILITY_AUDIT'],
  ['observability.audit.scope', 'CONFIG_INVALID_OBSERVABILITY_AUDIT_SCOPE'],
  ['observability.audit.buffer', 'CONFIG_INVALID_OBSERVABILITY_AUDIT_BUFFER'],
  ['observability.audit.buffer.maxEvents', 'CONFIG_INVALID_OBSERVABILITY_AUDIT_MAX_EVENTS'],
  ['observability.audit.buffer.maxBytes', 'CONFIG_INVALID_OBSERVABILITY_AUDIT_MAX_BYTES'],
  ['observability.audit.buffer.droppedWarn', 'CONFIG_INVALID_OBSERVABILITY_AUDIT_DROPPED_WARN'],

  // Security
  ['security', 'CONFIG_INVALID_SECURITY'],
  ['security.redaction', 'CONFIG_INVALID_SECURITY_REDACTION'],
  ['security.redaction.enabled', 'CONFIG_INVALID_SECURITY_REDACTION_ENABLED'],
  ['security.redaction.mark', 'CONFIG_INVALID_SECURITY_REDACTION_MARK'],
  ['security.redaction.maxDepth', 'CONFIG_INVALID_SECURITY_REDACTION_MAX_DEPTH'],
  ['security.redaction.keyAllowlist', 'CONFIG_INVALID_SECURITY_REDACTION_KEY_ALLOWLIST'],
  ['security.redaction.keyDenylist', 'CONFIG_INVALID_SECURITY_REDACTION_KEY_DENYLIST'],
  ['security.redaction.patterns', 'CONFIG_INVALID_SECURITY_REDACTION_PATTERNS'],
  ['security.redaction.disableDefaults', 'CONFIG_INVALID_SECURITY_REDACTION_DISABLE_DEFAULTS'],

  // Output
  ['output', 'CONFIG_INVALID_OUTPUT'],
  ['output.llm', 'CONFIG_INVALID_LLM_OUTPUT'],
  ['output.llm.kinds', 'CONFIG_INVALID_LLM_OUTPUT_KINDS'],
  ['output.markdown', 'CONFIG_INVALID_OUTPUT_MARKDOWN'],
  ['output.markdown.theme', 'CONFIG_INVALID_MARKDOWN_THEME'],
  ['output.markdown.mode', 'CONFIG_INVALID_MARKDOWN_RENDER_MODE'],

  // UI
  ['ui', 'CONFIG_INVALID_UI'],
  ['ui.log', 'CONFIG_INVALID_UI_LOG'],
  ['ui.log.view', 'CONFIG_INVALID_UI_LOG_VIEW'],
  ['ui.log.mode', 'CONFIG_INVALID_UI_LOG_MODE'],

  // Verify
  ['verify', 'CONFIG_INVALID_VERIFY'],
  ['verify.command', 'CONFIG_INVALID_VERIFY_COMMAND'],
  ['verify.timeoutMs', 'CONFIG_INVALID_VERIFY_TIMEOUT'],

  // AST Validation
  ['astValidation', 'CONFIG_INVALID_AST_VALIDATION'],
  ['astValidation.strictness', 'CONFIG_INVALID_AST_VALIDATION_STRICTNESS'],

  // LLM
  ['llm', 'CONFIG_INVALID_LLM'],
  ['llm.activeModel', 'CONFIG_INVALID_LLM_ACTIVE_MODEL'],
  ['llm.simpleModel', 'CONFIG_INVALID_LLM_SIMPLE_MODEL'],
  ['llm.mediumModel', 'CONFIG_INVALID_LLM_MEDIUM_MODEL'],
  ['llm.complexModel', 'CONFIG_INVALID_LLM_COMPLEX_MODEL'],
  ['llm.reasoningModel', 'CONFIG_INVALID_LLM_REASONING_MODEL'],
  ['llm.providers', 'CONFIG_INVALID_LLM_PROVIDERS'],
  ['llm.models', 'CONFIG_INVALID_LLM_MODELS'],
  ['llm.routing', 'CONFIG_INVALID_ROUTING'],
  ['llm.routing.fallbackProviders', 'CONFIG_INVALID_FALLBACK_PROVIDERS'],
  ['llm.routing.taskToModel', 'CONFIG_INVALID_TASK_TO_MODEL'],
  ['llm.routing.phaseToModel', 'CONFIG_INVALID_PHASE_TO_MODEL'],

  // Tool Authorization
  ['toolAuthorization', 'CONFIG_INVALID_TOOL_AUTH'],
  ['toolAuthorization.sessionTtlMs', 'CONFIG_INVALID_TOOL_AUTH_TTL'],
  ['toolAuthorization.autoAllowRisk', 'CONFIG_INVALID_TOOL_AUTH_RISK'],
  ['toolAuthorization.autoAllowRisk.low', 'CONFIG_INVALID_TOOL_AUTH_RISK_LOW'],
  ['toolAuthorization.autoAllowRisk.medium', 'CONFIG_INVALID_TOOL_AUTH_RISK_MEDIUM'],
  ['toolAuthorization.autoAllowRisk.high', 'CONFIG_INVALID_TOOL_AUTH_RISK_HIGH'],
  ['toolAuthorization.nonInteractive', 'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE'],
  [
    'toolAuthorization.nonInteractive.strategy',
    'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_STRATEGY',
  ],
  ['toolAuthorization.nonInteractive.command', 'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_COMMAND'],
  [
    'toolAuthorization.nonInteractive.command.cmd',
    'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_COMMAND_CMD',
  ],
  [
    'toolAuthorization.nonInteractive.command.timeoutMs',
    'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_COMMAND_TIMEOUT',
  ],
  ['toolAuthorization.nonInteractive.mcp', 'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP'],
  [
    'toolAuthorization.nonInteractive.mcp.server',
    'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP_SERVER',
  ],
  [
    'toolAuthorization.nonInteractive.mcp.tool',
    'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP_TOOL',
  ],
  [
    'toolAuthorization.nonInteractive.mcp.timeoutMs',
    'CONFIG_INVALID_TOOL_AUTH_NON_INTERACTIVE_MCP_TIMEOUT',
  ],
  ['toolAuthorization.allowlist', 'CONFIG_INVALID_TOOL_AUTH_ALLOWLIST'],
  ['toolAuthorization.allowlist.repoFile', 'CONFIG_INVALID_TOOL_AUTH_REPO_FILE'],
  ['toolAuthorization.allowlist.userFile', 'CONFIG_INVALID_TOOL_AUTH_USER_FILE'],
]);

// Patterns for dynamic path segments
const DYNAMIC_PATTERNS: Array<{
  test: (path: string[], issue?: z.ZodIssue) => boolean;
  code: string;
  details: (path: string[]) => Record<string, string>;
}> = [
  // LLM output kind validation
  {
    test: (p) => p.length >= 3 && p[0] === 'output' && p[1] === 'llm' && p[2] === 'kinds',
    code: 'CONFIG_INVALID_LLM_OUTPUT_KIND',
    details: () => ({ expected: 'valid LlmOutputKind' }),
  },
  // LLM providers — per-provider errors
  {
    test: (p) => p.length >= 3 && p[0] === 'llm' && p[1] === 'providers' && p.length === 3,
    code: 'CONFIG_INVALID_PROVIDER',
    details: (p) => ({ provider: p[2], expected: 'object' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'providers' && p[3] === 'type',
    code: 'CONFIG_INVALID_TYPE',
    details: (p) => ({ provider: p[2], expected: 'string' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'providers' && p[3] === 'client',
    code: 'CONFIG_INVALID_CLIENT',
    details: (p) => ({ provider: p[2], expected: 'object' }),
  },
  {
    test: (p) =>
      p.length >= 5 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'client' &&
      p[4] === 'package',
    code: 'CONFIG_INVALID_CLIENT_PACKAGE',
    details: (p) => ({ provider: p[2], expected: 'string' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'providers' && p[3] === 'api',
    code: 'CONFIG_INVALID_API',
    details: (p) => ({ provider: p[2], expected: 'object' }),
  },
  {
    test: (p) =>
      p.length >= 5 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'api' &&
      p[4] === 'baseUrl',
    code: 'CONFIG_INVALID_BASE_URL',
    details: (p) => ({ provider: p[2], expected: 'string' }),
  },
  {
    test: (p) =>
      p.length >= 5 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'api' &&
      p[4] === 'apiKey',
    code: 'CONFIG_INVALID_API_KEY',
    details: (p) => ({ provider: p[2], expected: 'string_or_null' }),
  },
  {
    test: (p) =>
      p.length >= 5 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'api' &&
      p[4] === 'timeoutMs',
    code: 'CONFIG_INVALID_TIMEOUT',
    details: (p) => ({ provider: p[2], expected: 'number' }),
  },
  {
    test: (p) =>
      p.length >= 5 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'api' &&
      p[4] === 'headers',
    code: 'CONFIG_INVALID_HEADERS',
    details: (p) => ({ provider: p[2], expected: 'object' }),
  },
  {
    test: (p) =>
      p.length >= 6 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'api' &&
      p[4] === 'headers',
    code: 'CONFIG_INVALID_HEADER_VALUE',
    details: (p) => ({ provider: p[2], header: p[5], expected: 'string' }),
  },
  {
    test: (p, issue) =>
      p.length === 4 &&
      p[0] === 'llm' &&
      p[1] === 'providers' &&
      p[3] === 'capabilities' &&
      issue?.code !== 'unrecognized_keys',
    code: 'CONFIG_INVALID_LLM_CAPABILITIES',
    details: (p) => ({ provider: p[2], expected: 'object' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'providers' && p[3] === 'capabilities',
    code: 'CONFIG_INVALID_LLM_CAPABILITY',
    details: (p) => ({ provider: p[2], capability: p[4] ?? '', expected: 'boolean' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'providers' && p[3] === 'models',
    code: 'CONFIG_LLM_PROVIDER_MODELS_NOT_SUPPORTED',
    details: (p) => ({ provider: p[2], hint: 'use llm.models with provider references' }),
  },
  // LLM models — per-model errors
  {
    test: (p) => p.length >= 3 && p[0] === 'llm' && p[1] === 'models' && p.length === 3,
    code: 'CONFIG_INVALID_LLM_MODEL_PROFILE',
    details: (p) => ({ model: p[2], expected: 'object' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'models' && p[3] === 'provider',
    code: 'CONFIG_INVALID_LLM_MODEL_PROVIDER',
    details: (p) => ({ model: p[2], expected: 'string_or_non_empty_string_array' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'models' && p[3] === 'id',
    code: 'CONFIG_INVALID_LLM_MODEL_ID',
    details: (p) => ({ model: p[2], expected: 'non_empty_string' }),
  },
  {
    test: (p, issue) =>
      p.length === 4 &&
      p[0] === 'llm' &&
      p[1] === 'models' &&
      p[3] === 'capabilities' &&
      issue?.code !== 'unrecognized_keys',
    code: 'CONFIG_INVALID_LLM_CAPABILITIES',
    details: (p) => ({ model: p[2], expected: 'object' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'models' && p[3] === 'capabilities',
    code: 'CONFIG_INVALID_LLM_CAPABILITY',
    details: (p) => ({ model: p[2], capability: p[4] ?? '', expected: 'boolean' }),
  },
  // LLM routing per-key errors
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'routing' && p[2] === 'taskToModel',
    code: 'CONFIG_INVALID_TASK_TO_MODEL_VALUE',
    details: (p) => ({ task: p[3], expected: 'string' }),
  },
  {
    test: (p) => p.length >= 4 && p[0] === 'llm' && p[1] === 'routing' && p[2] === 'phaseToModel',
    code: 'CONFIG_INVALID_PHASE_TO_MODEL_VALUE',
    details: (p) => ({ phase: p[3], expected: 'string' }),
  },
];

function resolveDynamicErrorCode(
  path: string[],
  issue?: z.ZodIssue,
): { code: string; details: Record<string, string> } | undefined {
  for (const pattern of DYNAMIC_PATTERNS) {
    if (pattern.test(path, issue)) {
      const details = pattern.details(path);
      // For unrecognized_keys, inject the unknown key into details
      if (issue?.code === 'unrecognized_keys') {
        const keys = (issue as z.ZodIssue & { keys?: string[] }).keys;
        if (keys && keys.length > 0 && !details.capability) {
          details.capability = keys[0];
        }
      }
      return { code: pattern.code, details };
    }
  }
  return undefined;
}

/**
 * Maps a Zod validation issue to a ConfigError with the correct error code.
 */
export function zodIssueToConfigError(issue: z.ZodIssue): ConfigError {
  // 1. Custom issues from .superRefine() carry configErrorCode in params
  if (issue.code === 'custom') {
    const params = (issue as z.ZodIssue & { params?: Record<string, unknown> }).params;
    if (params?.configErrorCode && typeof params.configErrorCode === 'string') {
      const details: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        if (k !== 'configErrorCode' && typeof v === 'string') {
          details[k] = v;
        }
      }
      return new ConfigError(params.configErrorCode, details);
    }
  }

  const path = issue.path.map(String);
  const pathKey = path.join('.');

  // 2. Handle unrecognized_keys (server .strict())
  if (issue.code === 'unrecognized_keys') {
    const keys = (issue as z.ZodIssue & { keys?: string[] }).keys;
    if (pathKey === 'server' && keys && keys.length > 0) {
      return new ConfigError('CONFIG_INVALID_SERVER_UNKNOWN_KEY', { key: keys[0] });
    }
    const staticCode = ERROR_CODE_MAP.get(pathKey);
    if (staticCode) {
      const details: Record<string, string> = {};
      if (keys && keys.length > 0) details.key = keys[0];
      return new ConfigError(staticCode, details);
    }
  }

  // 3. Dynamic pattern matching (before static to allow more specific matches)
  const dynamic = resolveDynamicErrorCode(path, issue);
  if (dynamic) {
    const details = { ...dynamic.details };
    if (issue.code === 'invalid_type') {
      details.expected = issue.expected;
    } else if (issue.code === 'invalid_element') {
      details.expected = (issue as z.ZodIssue & { options?: string[] }).options?.join('|') ?? '';
    }
    return new ConfigError(dynamic.code, details);
  }

  // 4. Static map lookup
  const staticCode = ERROR_CODE_MAP.get(pathKey);
  if (staticCode) {
    const details: Record<string, string> = {};
    if (issue.code === 'invalid_type') {
      details.expected = issue.expected;
    } else if (issue.code === 'invalid_value') {
      details.expected = String((issue as z.ZodIssue & { expected?: unknown }).expected ?? '');
    } else if (issue.code === 'invalid_element') {
      details.expected = (issue as z.ZodIssue & { options?: string[] }).options?.join('|') ?? '';
    }
    return new ConfigError(staticCode, details);
  }

  // 4. Fallback
  return new ConfigError('CONFIG_INVALID_ROOT', { expected: 'valid configuration' });
}
