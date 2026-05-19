export type McpUriPatternKind = 'exact' | 'prefix' | 'glob';

export interface McpUriRule {
  kind?: McpUriPatternKind;
  pattern: string;
}

export interface McpUriPolicyDecision {
  allowed: boolean;
  reason: string;
  matchedPattern?: string;
  matchKind?: McpUriPatternKind;
}

export function matchesMcpPattern(value: string, pattern: string): boolean {
  return matchesUriRule(value, pattern);
}

export function evaluateMcpUriPolicy(
  uri: string,
  rules: Array<string | McpUriRule>,
): McpUriPolicyDecision {
  if (rules.length === 0) {
    return {
      allowed: false,
      reason: 'MCP_RESOURCE_URI_DENIED_NO_RULES',
    };
  }

  for (const rule of rules) {
    const normalized = normalizeUriRule(rule);
    if (matchesUriRule(uri, normalized)) {
      return {
        allowed: true,
        reason: `MCP_RESOURCE_URI_ALLOWED_${normalized.kind.toUpperCase()}`,
        matchedPattern: normalized.pattern,
        matchKind: normalized.kind,
      };
    }
  }

  return {
    allowed: false,
    reason: 'MCP_RESOURCE_URI_DENIED_NO_MATCH',
  };
}

export function matchesUriRule(uri: string, rule: string | McpUriRule): boolean {
  const normalized = normalizeUriRule(rule);
  if (normalized.kind === 'exact') return uri === normalized.pattern;
  if (normalized.kind === 'prefix') return uri.startsWith(normalized.pattern);
  return globLikeToRegExp(normalized.pattern).test(uri);
}

export function normalizeUriRule(rule: string | McpUriRule): Required<McpUriRule> {
  if (typeof rule === 'string') {
    return { pattern: rule, kind: inferUriRuleKind(rule) };
  }
  return { pattern: rule.pattern, kind: rule.kind ?? inferUriRuleKind(rule.pattern) };
}

export class McpUriPolicy {
  isAllowed(uri: string, patterns: Array<string | McpUriRule>): boolean {
    return evaluateMcpUriPolicy(uri, patterns).allowed;
  }

  decide(uri: string, patterns: Array<string | McpUriRule>): McpUriPolicyDecision {
    return evaluateMcpUriPolicy(uri, patterns);
  }
}

function inferUriRuleKind(pattern: string): McpUriPatternKind {
  if (pattern.includes('*')) return 'glob';
  if (pattern.endsWith('/')) return 'prefix';
  return 'exact';
}

function globLikeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
