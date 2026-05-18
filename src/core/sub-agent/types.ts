import { z } from 'zod';

import type { ToolCallingAuditEntry } from '../llm/audit.js';
import type { ToolResultReplacementState } from '../session/replacement-state.js';
import { LoopResult } from '../types/index.js';
import type { LLMMessage } from '../types/llm.js';

import type { ArtifactHandle } from './artifacts/types.js';

/**
 * The standard execution protocol as per AGENTS.md
 */
export interface IExecutable<In, Out> {
  execute(input: In): Promise<Out>;
}

/**
 * Sub-Agent Profile defines the capabilities and constraints of a specialized agent.
 * (Serious Code, but used to spawn "Interns" or "Minions")
 */
export interface SubAgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;

  // Resource Budgets
  maxTokens?: number;
  maxAttempts?: number;
  timeoutMs?: number;

  // Capability Constraints
  allowedTools: string[]; // List of tool names
  readOnly: boolean; // If true, cannot use mutating tools even if authorized

  // Strategy Configuration
  stratagem: 'investigator' | 'surgeon' | 'janitor';
}

/**
 * Request to spawn a sub-agent.
 * Aligned with MCP/Clawster industry standards.
 */
export interface SubAgentRequest {
  agent_ref: string; // The profile ID (e.g., 'explorer')
  task: string; // The instruction/mission
  contextFiles?: string[];
  recursionDepth?: number;
  session_target: 'isolated' | 'shared';
  timeout_seconds?: number;
  contextSnapshot?: SubAgentContextSnapshot;

  // Overrides
  budgetOverride?: {
    maxTokens?: number;
  };
}

export interface SubAgentArtifactHints {
  verifyArtifact?: ArtifactHandle;
  subAgentPatchArtifacts?: ArtifactHandle[];
  subAgentAuditArtifacts?: ArtifactHandle[];
  recentReadArtifacts?: Array<{
    path: string;
    artifact: ArtifactHandle;
  }>;
  toolResultPreviewArtifacts?: Array<{
    label: string;
    artifact: ArtifactHandle;
  }>;
}

export const SUB_AGENT_CONTEXT_SNAPSHOT_VERSION = 1 as const;
export type SubAgentContextSnapshotVersion = typeof SUB_AGENT_CONTEXT_SNAPSHOT_VERSION;
export type SubAgentContextSnapshotField =
  | 'conversationContext'
  | 'artifactHints'
  | 'toolCallingAudit'
  | 'replacementState'
  | 'planRuntime'
  | 'cacheSharing';
export type SubAgentContextSnapshotSemantics = 'clone' | 'share';

/**
 * Versioned protocol contract for sub-agent context snapshot fields.
 *
 * - `clone`: mutable request/runtime data must be deep-cloned before dispatch.
 * - `share`: session-scoped coordination metadata is intentionally shared.
 */
export const SUB_AGENT_CONTEXT_SNAPSHOT_FIELD_SEMANTICS: Record<
  SubAgentContextSnapshotField,
  SubAgentContextSnapshotSemantics
> = {
  conversationContext: 'clone',
  artifactHints: 'clone',
  toolCallingAudit: 'clone',
  replacementState: 'clone',
  planRuntime: 'share',
  cacheSharing: 'share',
};

const SubAgentContextMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  reasoning_content: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
});

export interface SubAgentContextSnapshot {
  version?: SubAgentContextSnapshotVersion;
  conversationContext?: LLMMessage[];
  artifactHints?: SubAgentArtifactHints;
  toolCallingAudit?: ToolCallingAuditEntry[];
  replacementState?: ToolResultReplacementState;
  planRuntime?: {
    sessionId: string;
    planPathHint: string;
  };
  cacheSharing?: {
    namespace?: string;
    contextHash?: string;
    toolSchemaHash?: string;
    systemPrefixDigest?: string;
  };
}

/**
 * Result returned by a sub-agent upon mission completion or failure.
 */
export interface SubAgentResult extends LoopResult {
  agent_ref: string;
  summary: string;
  tokenUsage: number;
  auditPath?: string;
  /**
   * Optional patch artifact produced by the sub-agent.
   * - `handle` is a stable identifier (s8p namespace) for future protocol bridging.
   * - Read content via `artifact.read` to avoid repo writes.
   */
  patchArtifact?: ArtifactHandle;

  /**
   * Optional audit artifact for replay. For backward compatibility, `auditPath` may contain the
   * artifact handle when available.
   */
  auditArtifact?: ArtifactHandle;
}

/**
 * Sub-agent runtime status (used for UI/Omni-Tray)
 */
export type SubAgentStatus = 'hiring' | 'thinking' | 'working' | 'submitting' | 'terminated';

/**
 * Zod Schema for validation
 */
export const SubAgentRequestSchema = z.object({
  agent_ref: z
    .string()
    .describe('The specialized agent role to dispatch (e.g., explorer, surgeon)'),
  task: z.string().describe('The specific task or instruction for the sub-agent'),
  contextFiles: z.array(z.string()).optional(),
  recursionDepth: z.number().optional().default(0),
  session_target: z
    .enum(['isolated', 'shared'])
    .default('isolated')
    .describe('Whether the session should be isolated (shadow worktree) or shared'),
  timeout_seconds: z.number().optional().describe('Maximum execution time in seconds'),
  contextSnapshot: z
    .object({
      version: z.literal(SUB_AGENT_CONTEXT_SNAPSHOT_VERSION).optional().default(1),
      conversationContext: z.array(SubAgentContextMessageSchema).optional(),
      artifactHints: z
        .object({
          verifyArtifact: z
            .object({
              handle: z.string(),
              mimeType: z.string(),
              sha256: z.string(),
              size: z.number(),
            })
            .optional(),
          subAgentPatchArtifacts: z
            .array(
              z.object({
                handle: z.string(),
                mimeType: z.string(),
                sha256: z.string(),
                size: z.number(),
              }),
            )
            .optional(),
          subAgentAuditArtifacts: z
            .array(
              z.object({
                handle: z.string(),
                mimeType: z.string(),
                sha256: z.string(),
                size: z.number(),
              }),
            )
            .optional(),
          recentReadArtifacts: z
            .array(
              z.object({
                path: z.string(),
                artifact: z.object({
                  handle: z.string(),
                  mimeType: z.string(),
                  sha256: z.string(),
                  size: z.number(),
                }),
              }),
            )
            .optional(),
          toolResultPreviewArtifacts: z
            .array(
              z.object({
                label: z.string(),
                artifact: z.object({
                  handle: z.string(),
                  mimeType: z.string(),
                  sha256: z.string(),
                  size: z.number(),
                }),
              }),
            )
            .optional(),
        })
        .optional(),
      toolCallingAudit: z.array(z.record(z.string(), z.unknown())).optional(),
      replacementState: z
        .object({
          schemaVersion: z.number(),
          entries: z.record(
            z.string(),
            z.object({
              toolResultId: z.string(),
              decision: z.enum(['kept', 'replaced']),
              preview: z.string(),
              frozenAt: z.number(),
              sourceArtifactHandle: z.string().optional(),
              identityVersion: z.string(),
              hashAlgorithm: z.string(),
            }),
          ),
        })
        .optional(),
      planRuntime: z
        .object({
          sessionId: z.string(),
          planPathHint: z.string(),
        })
        .optional(),
      cacheSharing: z
        .object({
          namespace: z.string().optional(),
          contextHash: z.string().optional(),
          toolSchemaHash: z.string().optional(),
          systemPrefixDigest: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  budgetOverride: z
    .object({
      maxTokens: z.number().optional(),
    })
    .optional(),
});
