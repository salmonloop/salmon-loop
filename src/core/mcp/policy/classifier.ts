import type { RiskLevel, SideEffect } from '../../tools/types.js';
import type { McpToolDescriptor, McpTrustLevel } from '../types.js';

export type McpRiskFacet = 'read' | 'write' | 'network' | 'process';

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

export interface McpToolLike {
  name: string;
  description?: string;
  annotations?: McpToolAnnotations | Record<string, unknown>;
}

export interface McpClassifierOverride {
  risk?: RiskLevel;
  facets?: Partial<Record<McpRiskFacet, boolean>>;
  sideEffects?: SideEffect[];
  readOnly?: boolean;
  allowUnsafeDowngrade?: boolean;
  reason?: string;
}

export interface McpToolClassifierConfig {
  trust?: McpTrustLevel;
  override?: McpClassifierOverride;
  overrides?: Record<string, McpClassifierOverride>;
}

export interface McpClassifierLegacyInput {
  tool: Pick<McpToolDescriptor, 'name' | 'description'> & {
    annotations?: Record<string, unknown>;
  };
  trust: McpTrustLevel;
  override?: SideEffect[];
}

export interface McpToolClassification {
  kind: 'classified';
  risk: RiskLevel;
  riskLevel: RiskLevel;
  facets: Record<McpRiskFacet, boolean>;
  sideEffects: SideEffect[];
  reasons: string[];
  reason: string;
}

const RISK_SCORE: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const SCORE_RISK: RiskLevel[] = ['low', 'medium', 'high'];

const READ_PATTERN = /\b(read|get|list|search|find|status|query|fetch|inspect|show|lookup)\b/i;
const WRITE_PATTERN =
  /\b(write|create|update|delete|remove|apply|run|exec|submit|merge|push|patch|install|set|edit)\b/i;
const NETWORK_PATTERN =
  /\b(fetch|http|https|url|web|crawl|browser|request|download|upload|api|remote|network)\b/i;
const PROCESS_PATTERN =
  /\b(exec|execute|run|shell|bash|sh|cmd|command|process|spawn|npm|pnpm|yarn|bun|node|python|ruby|go|cargo|git)\b/i;

export function classifyMcpTool(input: McpClassifierLegacyInput): McpToolClassification;
export function classifyMcpTool(
  tool: McpToolLike,
  config?: McpToolClassifierConfig,
): McpToolClassification;
export function classifyMcpTool(
  inputOrTool: McpClassifierLegacyInput | McpToolLike,
  config: McpToolClassifierConfig = {},
): McpToolClassification {
  const legacy = isLegacyInput(inputOrTool);
  const tool = legacy ? inputOrTool.tool : inputOrTool;
  const trust = legacy ? inputOrTool.trust : (config.trust ?? 'local');
  const override = legacy
    ? sideEffectOverrideToConfig(inputOrTool.override)
    : mergeOverrides(config.override, config.overrides?.[tool.name]);
  return classifyTool({ tool, trust, override });
}

function classifyTool(input: {
  tool: McpToolLike;
  trust: McpTrustLevel;
  override?: McpClassifierOverride;
}): McpToolClassification {
  const facets: Record<McpRiskFacet, boolean> = {
    read: false,
    write: false,
    network: false,
    process: false,
  };
  const reasons: string[] = [];
  const text = normalizeClassificationText(
    `${input.tool.name ?? ''} ${input.tool.description ?? ''}`,
  );
  const annotations = input.tool.annotations ?? {};

  if (READ_PATTERN.test(text)) {
    facets.read = true;
    reasons.push('name or description implies read access');
  }
  if (WRITE_PATTERN.test(text)) {
    facets.write = true;
    reasons.push('name or description implies write access');
  }
  if (NETWORK_PATTERN.test(text)) {
    facets.network = true;
    reasons.push('name or description implies network access');
  }
  if (PROCESS_PATTERN.test(text)) {
    facets.process = true;
    reasons.push('name or description implies process execution');
  }

  if (annotations.readOnlyHint === true) {
    facets.read = true;
    if (annotations.destructiveHint !== true) {
      facets.write = false;
      facets.process = false;
    }
    reasons.push('annotation marks tool read-only');
  }
  if (annotations.destructiveHint === true) {
    facets.write = true;
    reasons.push('annotation marks tool destructive');
  }
  if (annotations.openWorldHint === true) {
    facets.network = true;
    reasons.push('annotation marks tool open-world');
  }

  const baselineRisk = riskFromFacets(facets, input.trust);
  if (input.override?.readOnly === true) {
    facets.read = true;
    facets.write = false;
    facets.process = false;
    reasons.push(input.override.reason ?? 'config override marks tool read-only');
  }
  if (input.override?.facets) {
    for (const facet of Object.keys(input.override.facets) as McpRiskFacet[]) {
      facets[facet] = Boolean(input.override.facets[facet]);
    }
    reasons.push(input.override.reason ?? 'config override adjusts risk facets');
  }
  if (input.override?.sideEffects) {
    applySideEffectsToFacets(facets, input.override.sideEffects);
    reasons.push(input.override.reason ?? 'config override adjusts side effects');
  }

  let risk = riskFromFacets(facets, input.trust);
  if (input.override?.risk) {
    risk = applyRiskOverride(baselineRisk, input.override);
    reasons.push(input.override.reason ?? `config override sets risk to ${risk}`);
  }
  if (input.trust === 'remote') {
    risk = raiseRisk(risk);
    reasons.push('remote MCP server raises risk');
  }
  if (!reasons.length) {
    reasons.push('no risk signals found');
  }

  const sideEffects = sideEffectsFromFacets(facets, input.trust);
  const reason = reasons.join('; ');
  return {
    kind: 'classified',
    risk,
    riskLevel: risk,
    facets,
    sideEffects,
    reasons,
    reason,
  };
}

function isLegacyInput(
  input: McpClassifierLegacyInput | McpToolLike,
): input is McpClassifierLegacyInput {
  return 'tool' in input && 'trust' in input;
}

function sideEffectOverrideToConfig(
  sideEffects: SideEffect[] | undefined,
): McpClassifierOverride | undefined {
  return sideEffects && sideEffects.length > 0 ? { sideEffects } : undefined;
}

function applySideEffectsToFacets(
  facets: Record<McpRiskFacet, boolean>,
  sideEffects: SideEffect[],
): void {
  facets.read = sideEffects.some((effect) => effect === 'fs_read' || effect === 'git_read');
  facets.write = sideEffects.some(
    (effect) => effect === 'fs_write' || effect === 'git_write' || effect === 'snapshot_mutate',
  );
  facets.network = sideEffects.includes('network');
  facets.process = sideEffects.includes('process');
}

function sideEffectsFromFacets(
  facets: Record<McpRiskFacet, boolean>,
  trust: McpTrustLevel,
): SideEffect[] {
  const effects: SideEffect[] = [];
  if (facets.read) effects.push('fs_read');
  if (facets.write) effects.push('fs_write');
  if (facets.process) effects.push('process');
  if (facets.network || trust === 'remote') effects.push('network');
  return uniqueSideEffects(effects.length > 0 ? effects : ['none']);
}

function riskFromFacets(facets: Record<McpRiskFacet, boolean>, trust: McpTrustLevel): RiskLevel {
  if (facets.process || facets.write || (facets.write && facets.network)) {
    return 'high';
  }
  if (facets.network || trust === 'remote') {
    return 'medium';
  }
  return 'low';
}

function applyRiskOverride(baselineRisk: RiskLevel, override: McpClassifierOverride): RiskLevel {
  const requestedRisk = override.risk;
  if (!requestedRisk) {
    return baselineRisk;
  }
  if (compareRisk(requestedRisk, baselineRisk) >= 0 || override.allowUnsafeDowngrade === true) {
    return requestedRisk;
  }
  return (
    SCORE_RISK[Math.max(RISK_SCORE[baselineRisk] - 1, RISK_SCORE[requestedRisk])] ?? baselineRisk
  );
}

function raiseRisk(risk: RiskLevel): RiskLevel {
  return SCORE_RISK[Math.min(RISK_SCORE[risk] + 1, SCORE_RISK.length - 1)] ?? 'high';
}

function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_SCORE[left] - RISK_SCORE[right];
}

function mergeOverrides(
  base: McpClassifierOverride | undefined,
  named: McpClassifierOverride | undefined,
): McpClassifierOverride | undefined {
  if (!base) return named;
  if (!named) return base;
  return {
    ...base,
    ...named,
    facets: {
      ...base.facets,
      ...named.facets,
    },
  };
}

function uniqueSideEffects(values: SideEffect[]): SideEffect[] {
  return Array.from(new Set(values));
}

function normalizeClassificationText(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, ' ');
}
