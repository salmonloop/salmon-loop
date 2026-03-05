import type { AstValidationStrictness, ToolAuthorizationConfig } from './types.js';

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
