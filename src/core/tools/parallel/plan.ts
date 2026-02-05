import { RiskLevel, ToolSpec } from '../types.js';

import { ResourceKey } from './resources.js';

export type NodeId = string;

export type NodeStatus =
  | 'PENDING'
  | 'READY'
  | 'BLOCKED_APPROVAL'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';

export interface ApprovalRequest {
  nodeId: NodeId;
  toolName: string;
  riskLevel: RiskLevel;
  message: string;
  confirmToken?: string;
}

export interface NodeResult {
  status: NodeStatus;
  output?: any;
  error?: any;
  approval?: ApprovalRequest;
  toolResult?: any;
  timing?: {
    lockWaitMs: number;
    runMs: number;
  };
}

export interface PlanNode {
  id: NodeId;
  toolName: string;
  args: any;
  deps?: NodeId[];

  // Resolved during execution/planning
  spec?: ToolSpec;
  resources?: ResourceKey[];
}

export interface ExecutionPolicy {
  maxParallelism: number;
  readParallelism?: number;
  writeParallelism?: number;
  failFast: boolean;
  deterministic: boolean;
}

export interface ExecutionPlan {
  id: string;
  nodes: PlanNode[];
  policy: ExecutionPolicy;
}

export interface PlanRunResult {
  planId: string;
  nodeResults: Record<NodeId, NodeResult>;
  failed: boolean;
  canceled: boolean;
  blockedApprovals: ApprovalRequest[];
  recording?: PlanRecording;
}

export interface ScheduleStep {
  t: number; // Monotonic sequence
  picked: NodeId;
  readySet: NodeId[];
  readRunning: number;
  writeRunning: number;
}

export interface PlanRecording {
  steps: ScheduleStep[];
}

export interface PlanRunOptions {
  record?: boolean;
  replay?: PlanRecording;
  initialResults?: Record<NodeId, NodeResult>;
  resumeBlockedApprovals?: boolean;
}
