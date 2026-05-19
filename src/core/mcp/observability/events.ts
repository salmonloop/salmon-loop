import type { RiskLevel } from '../../tools/types.js';
import type { ExecutionPhase } from '../../types/runtime.js';
import type { McpPolicyAction, McpPolicyOutcome } from '../policy/grants.js';
import type { McpCapabilityKind } from '../types.js';

export interface McpObservabilityEvent {
  action: string;
  server: string;
  capability: McpCapabilityKind;
  outcome: 'ok' | 'denied' | 'error' | 'stale' | McpPolicyOutcome;
  reason?: string;
  phase?: ExecutionPhase;
  riskLevel?: string;
  risk?: RiskLevel;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface McpPolicyEventInput {
  server: string;
  capability: McpCapabilityKind;
  action: McpPolicyAction;
  outcome: McpPolicyOutcome;
  reason: string;
  phase?: ExecutionPhase;
  risk: RiskLevel;
  target?: string;
}

export interface McpPolicyEvent extends McpObservabilityEvent {
  type: 'mcp.policy.decision';
  action: McpPolicyAction;
  outcome: McpPolicyOutcome;
  reason: string;
  risk: RiskLevel;
  target?: string;
}

export function buildMcpEvent(
  input: Omit<McpObservabilityEvent, 'timestamp'>,
): McpObservabilityEvent {
  return { ...input, timestamp: new Date().toISOString() };
}

export function buildMcpPolicyEvent(input: McpPolicyEventInput): McpPolicyEvent {
  return {
    type: 'mcp.policy.decision',
    server: input.server,
    capability: input.capability,
    action: input.action,
    outcome: input.outcome,
    reason: input.reason,
    phase: input.phase,
    risk: input.risk,
    riskLevel: input.risk,
    target: input.target,
    timestamp: new Date().toISOString(),
  };
}
