import type { RedactionConfig } from '../security/redaction.js';

import type { AstValidationStrictness, ResolvedConfig, ToolAuthorizationConfig } from './types.js';

const MINUTE_MS = 60_000;

export const DEFAULT_TOOL_AUTH: ToolAuthorizationConfig = {
  sessionTtlMs: 30 * MINUTE_MS,
  autoAllowRisk: {
    low: true,
    medium: false,
    high: false,
  },
  nonInteractive: {
    strategy: 'deny',
  },
  allowlist: {
    repoFile: '.salmonloop/config/authorization.json',
    userFile: '~/.salmonloop/config/authorization-user.json',
    summary: {
      every: 100,
      minIntervalMs: 10 * MINUTE_MS,
      failureMinIntervalMs: 1 * MINUTE_MS,
      maxToolStats: 1000,
      maxPathStats: 2000,
    },
    matching: {
      denySideEffects: 'any',
      allowSideEffects: 'all',
    },
  },
};

export const DEFAULT_AST_VALIDATION_STRICTNESS: AstValidationStrictness = 'lenient';

export const DEFAULT_USE_TOKEN_BUDGET = true;

export const DEFAULT_DYNAMIC_BUDGET: ResolvedConfig['context']['dynamicBudget'] = {
  enabled: false,
  minBudget: 5000,
  maxBudget: 100000,
  adjustmentStep: 0.15,
  alerts: {
    truncationRateWarn: 0.6,
    criticalDropRateWarn: 0,
  },
};

export const DEFAULT_AUDIT_BUFFER: ResolvedConfig['observability']['audit']['buffer'] = {
  maxEvents: 10_000,
  maxBytes: 20 * 1024 * 1024,
  droppedWarn: 100,
};

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  enabled: true,
  mark: '[REDACTED]',
  maxDepth: 6,
};
