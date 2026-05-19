import type { RiskLevel } from '../../tools/types.js';
import type { ExecutionPhase } from '../../types/runtime.js';
import type {
  McpApprovalMode,
  McpCapabilityKind,
  McpPromptExposure,
  McpRootsMode,
  McpServerCapabilityConfig,
  McpServerId,
  McpToolClassification as LegacyMcpToolClassification,
  McpTransportType,
  McpTrustLevel,
} from '../types.js';

import { classifyMcpTool, type McpToolLike } from './classifier.js';
import {
  evaluateMcpUriPolicy,
  matchesMcpPattern,
  McpUriPolicy,
  type McpUriRule,
} from './uri-policy.js';

export type McpPolicyOutcome = 'allow' | 'deny' | 'ask';
export type McpPolicyAction = 'read' | 'write' | 'list' | 'call' | 'request' | string;
export type McpGrantTarget = string | Array<string | McpUriRule> | McpUriRule;

export type McpGrant =
  | {
      kind: 'tool';
      server: McpServerId;
      namePattern: string;
      phases: ExecutionPhase[];
      approval: McpApprovalMode;
      risk?: RiskLevel;
      reason?: string;
    }
  | {
      kind: 'resource';
      server: McpServerId;
      uriPattern: string;
      autoInclude: boolean;
      reason?: string;
    }
  | {
      kind: 'prompt';
      server: McpServerId;
      namePattern: string;
      exposeAs: McpPromptExposure;
      reason?: string;
    }
  | {
      kind: 'roots';
      server: McpServerId;
      mode: McpRootsMode;
      reason?: string;
    }
  | {
      kind: 'sampling';
      server: McpServerId;
      enabled: boolean;
      maxTokens: number;
      maxDepth: number;
      reason?: string;
    }
  | {
      kind: 'elicitation';
      server: McpServerId;
      enabled: boolean;
      reason?: string;
    }
  | {
      kind?: undefined;
      server: McpServerId;
      capability: McpCapabilityKind;
      actions?: McpPolicyAction[];
      target?: McpGrantTarget;
      outcome?: McpPolicyOutcome;
      phase?: ExecutionPhase | ExecutionPhase[];
      risk?: RiskLevel;
      reason?: string;
    };

export interface McpPolicyDecision {
  allowed: boolean;
  approvalRequired?: boolean;
  needsApproval?: boolean;
  denyReason?: string;
  reason?: string;
  outcome?: McpPolicyOutcome;
  grant?: McpGrant;
  phase?: ExecutionPhase;
  risk?: RiskLevel;
  server?: string;
  capability?: McpCapabilityKind;
  action?: McpPolicyAction;
}

export interface McpPolicyServerContext {
  name: McpServerId;
  transport?: McpTransportType;
  trust?: McpTrustLevel;
}

export interface McpPolicyRequest {
  server: McpPolicyServerContext;
  capability: McpCapabilityKind;
  action: McpPolicyAction;
  target?: string;
  phase?: ExecutionPhase;
  tool?: McpToolLike;
}

export interface McpApprovalPolicyInput {
  capability: McpCapabilityKind;
  action?: McpPolicyAction;
  risk: RiskLevel;
  defaultOutcome?: McpPolicyOutcome;
  remote?: boolean;
}

export interface McpApprovalPolicyDecision {
  outcome: McpPolicyOutcome;
  reason: string;
  risk: RiskLevel;
}

export function decideMcpApprovalPolicy(input: McpApprovalPolicyInput): McpApprovalPolicyDecision {
  const risk = input.remote ? raiseRisk(input.risk) : input.risk;
  if (input.capability === 'sampling') {
    return {
      outcome: input.defaultOutcome ?? 'deny',
      reason: input.defaultOutcome
        ? 'MCP_SAMPLING_EXPLICIT_GRANT'
        : 'MCP_SAMPLING_DENIED_BY_DEFAULT',
      risk,
    };
  }
  if (input.capability === 'elicitation') {
    return {
      outcome: input.defaultOutcome ?? 'ask',
      reason: 'MCP_ELICITATION_APPROVAL_REQUIRED_BY_DEFAULT',
      risk,
    };
  }
  if (risk === 'high') {
    return {
      outcome: input.defaultOutcome ?? 'ask',
      reason: 'MCP_HIGH_RISK_APPROVAL_REQUIRED',
      risk,
    };
  }
  return {
    outcome: input.defaultOutcome ?? 'allow',
    reason: 'MCP_GRANTED',
    risk,
  };
}

export class McpPolicyEngine {
  private uriPolicy = new McpUriPolicy();
  private grants: McpGrant[];

  constructor(input: McpGrant[] | { grants?: McpGrant[] } = []) {
    this.grants = Array.isArray(input) ? input : (input.grants ?? []);
  }

  decide(request: McpPolicyRequest): McpPolicyDecision {
    if (request.capability === 'tools') {
      return this.decideTool({
        server: request.server.name,
        toolName: request.target ?? request.tool?.name ?? '',
        phase: request.phase,
        classification: request.tool
          ? classifyMcpTool(request.tool, { trust: request.server.trust ?? 'local' })
          : undefined,
        remote: request.server.trust === 'remote' || request.server.transport === 'http',
      });
    }
    if (request.capability === 'resources') {
      return this.decideResource({
        server: request.server.name,
        uri: request.target ?? '',
      });
    }
    if (request.capability === 'prompts') {
      return this.decidePrompt({
        server: request.server.name,
        name: request.target ?? '',
      });
    }
    if (request.capability === 'roots') {
      return this.decideRoots(request.server.name, request.target);
    }
    if (request.capability === 'sampling') {
      return this.decideSampling(request.server.name, request.target);
    }
    return this.decideElicitation(request.server.name, request.target);
  }

  decideTool(input: {
    server: string;
    toolName: string;
    phase?: ExecutionPhase;
    classification?: LegacyMcpToolClassification;
    remote?: boolean;
  }): McpPolicyDecision {
    const grant = this.grants.find(
      (item): item is Extract<McpGrant, { kind: 'tool' }> =>
        'kind' in item &&
        item.kind === 'tool' &&
        matchesServer(item.server, input.server) &&
        matchesMcpPattern(input.toolName, item.namePattern),
    );
    const genericGrant = this.findGenericGrant(
      'tools',
      input.server,
      'call',
      input.toolName,
      input.phase,
    );
    const matchedGrant = grant ?? genericGrant;
    if (!matchedGrant) {
      return deny('MCP_TOOL_NOT_GRANTED', {
        server: input.server,
        capability: 'tools',
        action: 'call',
      });
    }

    const phaseAllowed = grant
      ? input.phase !== undefined && grant.phases.includes(input.phase)
      : matchesPhase(genericGrant?.phase, input.phase);
    if (!phaseAllowed) {
      return deny('MCP_TOOL_PHASE_DENIED', {
        grant: matchedGrant,
        server: input.server,
        capability: 'tools',
        action: 'call',
        phase: input.phase,
      });
    }

    const hasWriteRisk =
      input.classification?.riskLevel === 'high' ||
      input.classification?.sideEffects.some((effect) =>
        ['fs_write', 'git_write', 'process', 'network'].includes(effect),
      );
    const risk = input.remote
      ? raiseRisk(input.classification?.riskLevel ?? 'medium')
      : (input.classification?.riskLevel ?? 'medium');
    const outcome = grant
      ? legacyToolOutcome(grant.approval, Boolean(hasWriteRisk))
      : (genericGrant?.outcome ??
        decideMcpApprovalPolicy({ capability: 'tools', risk, remote: input.remote }).outcome);

    return allowOrAsk(outcome, matchedGrant.reason ?? 'MCP_TOOL_GRANTED', {
      grant: matchedGrant,
      risk,
      server: input.server,
      capability: 'tools',
      action: 'call',
      phase: input.phase,
    });
  }

  decideResource(input: { server: string; uri: string }): McpPolicyDecision {
    const grant = this.grants.find(
      (item): item is Extract<McpGrant, { kind: 'resource' }> =>
        'kind' in item &&
        item.kind === 'resource' &&
        matchesServer(item.server, input.server) &&
        this.uriPolicy.isAllowed(input.uri, [item.uriPattern]),
    );
    const genericGrant =
      grant ?? this.findGenericGrant('resources', input.server, 'read', input.uri);
    if (!genericGrant) {
      return deny('MCP_RESOURCE_URI_DENIED', {
        server: input.server,
        capability: 'resources',
        action: 'read',
      });
    }
    if (!('kind' in genericGrant)) {
      const rules = Array.isArray(genericGrant.target)
        ? genericGrant.target
        : genericGrant.target
          ? [genericGrant.target]
          : [];
      const uriDecision = evaluateMcpUriPolicy(input.uri, rules);
      if (!uriDecision.allowed) {
        return deny(uriDecision.reason, {
          grant: genericGrant,
          server: input.server,
          capability: 'resources',
          action: 'read',
        });
      }
    }
    return allowOrAsk('allow', genericGrant.reason ?? 'MCP_RESOURCE_GRANTED', {
      grant: genericGrant,
      risk: 'low',
      server: input.server,
      capability: 'resources',
      action: 'read',
    });
  }

  decidePrompt(input: { server: string; name: string }): McpPolicyDecision {
    const grant = this.grants.find(
      (item): item is Extract<McpGrant, { kind: 'prompt' }> =>
        'kind' in item &&
        item.kind === 'prompt' &&
        matchesServer(item.server, input.server) &&
        matchesMcpPattern(input.name, item.namePattern) &&
        item.exposeAs !== 'none',
    );
    const genericGrant =
      grant ?? this.findGenericGrant('prompts', input.server, 'read', input.name);
    return genericGrant
      ? allowOrAsk('allow', genericGrant.reason ?? 'MCP_PROMPT_GRANTED', {
          grant: genericGrant,
          risk: 'low',
          server: input.server,
          capability: 'prompts',
          action: 'read',
        })
      : deny('MCP_PROMPT_DENIED', {
          server: input.server,
          capability: 'prompts',
          action: 'read',
        });
  }

  decideRoots(server: string, target?: string): McpPolicyDecision {
    const grant = this.grants.find(
      (item): item is Extract<McpGrant, { kind: 'roots' }> =>
        'kind' in item &&
        item.kind === 'roots' &&
        matchesServer(item.server, server) &&
        item.mode !== 'none',
    );
    const genericGrant = grant ?? this.findGenericGrant('roots', server, 'read', target);
    return genericGrant
      ? allowOrAsk('allow', genericGrant.reason ?? 'MCP_ROOTS_GRANTED', {
          grant: genericGrant,
          risk: 'low',
          server,
          capability: 'roots',
          action: 'read',
        })
      : deny('MCP_ROOTS_DENIED', { server, capability: 'roots', action: 'read' });
  }

  decideSampling(server: string, target?: string): McpPolicyDecision {
    const grant = this.grants.find(
      (item): item is Extract<McpGrant, { kind: 'sampling' }> =>
        'kind' in item &&
        item.kind === 'sampling' &&
        matchesServer(item.server, server) &&
        item.enabled,
    );
    const genericGrant = grant ?? this.findGenericGrant('sampling', server, 'request', target);
    if (!genericGrant) {
      return deny('MCP_SAMPLING_DENIED', { server, capability: 'sampling', action: 'request' });
    }
    const outcome = 'kind' in genericGrant ? 'ask' : (genericGrant.outcome ?? 'deny');
    return allowOrAsk(outcome, genericGrant.reason ?? 'MCP_SAMPLING_GRANTED', {
      grant: genericGrant,
      risk: 'high',
      server,
      capability: 'sampling',
      action: 'request',
    });
  }

  decideElicitation(server: string, target?: string): McpPolicyDecision {
    const grant = this.grants.find(
      (item): item is Extract<McpGrant, { kind: 'elicitation' }> =>
        'kind' in item &&
        item.kind === 'elicitation' &&
        matchesServer(item.server, server) &&
        item.enabled,
    );
    const genericGrant = grant ?? this.findGenericGrant('elicitation', server, 'request', target);
    if (!genericGrant) {
      return allowOrAsk('ask', 'MCP_ELICITATION_APPROVAL_REQUIRED_BY_DEFAULT', {
        risk: 'medium',
        server,
        capability: 'elicitation',
        action: 'request',
      });
    }
    const outcome = 'kind' in genericGrant ? 'ask' : (genericGrant.outcome ?? 'ask');
    return allowOrAsk(outcome, genericGrant.reason ?? 'MCP_ELICITATION_GRANTED', {
      grant: genericGrant,
      risk: 'medium',
      server,
      capability: 'elicitation',
      action: 'request',
    });
  }

  private findGenericGrant(
    capability: McpCapabilityKind,
    server: string,
    action: McpPolicyAction,
    target?: string,
    phase?: ExecutionPhase,
  ): Extract<McpGrant, { capability: McpCapabilityKind }> | undefined {
    return this.grants.find(
      (grant): grant is Extract<McpGrant, { capability: McpCapabilityKind }> =>
        !('kind' in grant) &&
        grant.capability === capability &&
        matchesServer(grant.server, server) &&
        matchesAction(grant.actions, action) &&
        matchesGenericTarget(grant.target, target) &&
        matchesPhase(grant.phase, phase),
    );
  }
}

export function buildMcpGrantsFromCapabilities(
  server: McpServerId,
  capabilities: McpServerCapabilityConfig,
): McpGrant[] {
  const grants: McpGrant[] = [];
  for (const namePattern of capabilities.tools.allow) {
    grants.push({
      kind: 'tool',
      server,
      namePattern,
      phases: capabilities.tools.phases,
      approval: capabilities.tools.approval,
    });
  }
  for (const uriPattern of capabilities.resources.allowUris) {
    grants.push({
      kind: 'resource',
      server,
      uriPattern,
      autoInclude: capabilities.resources.autoInclude,
    });
  }
  for (const namePattern of capabilities.prompts.allow) {
    grants.push({
      kind: 'prompt',
      server,
      namePattern,
      exposeAs: capabilities.prompts.exposeAs,
    });
  }
  grants.push({ kind: 'roots', server, mode: capabilities.roots.mode });
  grants.push({
    kind: 'sampling',
    server,
    enabled: capabilities.sampling.enabled,
    maxTokens: capabilities.sampling.maxTokens,
    maxDepth: capabilities.sampling.maxDepth,
  });
  grants.push({ kind: 'elicitation', server, enabled: capabilities.elicitation.enabled });
  return grants;
}

export function getCapabilityKindForGrant(grant: McpGrant): McpCapabilityKind {
  if ('capability' in grant) return grant.capability;
  if (grant.kind === 'tool') return 'tools';
  if (grant.kind === 'resource') return 'resources';
  if (grant.kind === 'prompt') return 'prompts';
  return grant.kind;
}

export function getGrantServer(grant: McpGrant): McpServerId {
  return grant.server;
}

export function grantOutcomeToApprovalMode(outcome: McpPolicyOutcome | undefined): McpApprovalMode {
  if (outcome === 'ask') return 'ask';
  return 'never';
}

function legacyToolOutcome(approval: string, hasWriteRisk: boolean): McpPolicyOutcome {
  if (approval === 'ask') return 'ask';
  if (approval === 'write_requires_confirmation' && hasWriteRisk) return 'ask';
  return 'allow';
}

function allowOrAsk(
  outcome: McpPolicyOutcome,
  reason: string,
  details: Omit<
    McpPolicyDecision,
    'allowed' | 'approvalRequired' | 'needsApproval' | 'outcome' | 'reason'
  >,
): McpPolicyDecision {
  return {
    ...details,
    allowed: outcome === 'allow',
    approvalRequired: outcome === 'ask',
    needsApproval: outcome === 'ask',
    outcome,
    reason,
    denyReason: outcome === 'deny' ? reason : undefined,
  };
}

function deny(
  reason: string,
  details: Omit<
    McpPolicyDecision,
    'allowed' | 'approvalRequired' | 'needsApproval' | 'outcome' | 'reason'
  >,
): McpPolicyDecision {
  return {
    ...details,
    allowed: false,
    approvalRequired: false,
    needsApproval: false,
    outcome: 'deny',
    reason,
    denyReason: reason,
  };
}

function matchesServer(pattern: string, server: string): boolean {
  return pattern === '*' || pattern === server;
}

function matchesAction(actions: McpPolicyAction[] | undefined, action: McpPolicyAction): boolean {
  return !actions?.length || actions.includes('*') || actions.includes(action);
}

function matchesPhase(
  grantPhase: ExecutionPhase | ExecutionPhase[] | undefined,
  requestPhase: ExecutionPhase | undefined,
): boolean {
  if (!grantPhase) return true;
  if (!requestPhase) return false;
  return Array.isArray(grantPhase)
    ? grantPhase.includes(requestPhase)
    : grantPhase === requestPhase;
}

function matchesGenericTarget(
  target: Extract<McpGrant, { capability: McpCapabilityKind }>['target'],
  requestedTarget: string | undefined,
): boolean {
  if (!target) return true;
  if (!requestedTarget) return false;
  const targets = Array.isArray(target) ? target : [target];
  return targets.some((item) =>
    typeof item === 'string'
      ? matchesMcpPattern(requestedTarget, item)
      : matchesMcpPattern(requestedTarget, item.pattern),
  );
}

function raiseRisk(risk: RiskLevel): RiskLevel {
  if (risk === 'low') return 'medium';
  return 'high';
}
