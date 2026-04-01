import { z } from 'zod';

import type { ToolCallingAuditEntry } from '../llm/audit.js';
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
}

export interface SubAgentContextSnapshot {
  conversationContext?: LLMMessage[];
  artifactHints?: SubAgentArtifactHints;
  toolCallingAudit?: ToolCallingAuditEntry[];
  planRuntime?: {
    sessionId: string;
    planPathHint: string;
  };
  cacheSharing?: {
    namespace?: string;
    contextHash?: string;
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
      conversationContext: z
        .array(
          z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string(),
          }),
        )
        .optional(),
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
        })
        .optional(),
      toolCallingAudit: z.array(z.record(z.string(), z.unknown())).optional(),
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
