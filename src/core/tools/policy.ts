import { Phase } from '../types';

import { ExecutionPhase, ToolSpec } from './types';

export interface PolicyDecision {
  allowed: boolean;
  denyReason?: string;
}

export class ToolPolicy {
  /**
   * Decide if a tool execution is allowed in the current phase and context.
   */
  decide(phase: ExecutionPhase, spec: ToolSpec, ctx: { worktreeRoot?: string }): PolicyDecision {
    // 1. Phase Allowlist Check
    if (!this.isToolAllowedInPhase(phase, spec)) {
      return { allowed: false, denyReason: `Tool ${spec.name} is not allowed in phase ${phase}` };
    }

    // 2. Side Effect Analysis
    const hasWrite =
      spec.sideEffects.includes('fs_write') || spec.sideEffects.includes('git_write');
    const hasProcess = spec.sideEffects.includes('process');
    const hasNetwork = spec.sideEffects.includes('network');

    // 3. APPLY phase is strictly for patch application, NO tool calls allowed
    if (phase === Phase.APPLY) {
      return {
        allowed: false,
        denyReason:
          'Tool execution is strictly forbidden in APPLY phase (use patch apply mechanism)',
      };
    }

    // 4. Worktree Requirement for Side Effects
    // Any tool with mutation side effects or process execution MUST have a worktree
    if ((hasWrite || hasProcess || hasNetwork) && !ctx.worktreeRoot) {
      return {
        allowed: false,
        denyReason: `Tool ${spec.name} has side effects [${spec.sideEffects.join(',')}] and requires worktree isolation`,
      };
    }

    // 5. PLAN/PATCH phases should remain deterministic
    if ((phase === Phase.PLAN || phase === Phase.PATCH) && (hasWrite || hasProcess || hasNetwork)) {
      return {
        allowed: false,
        denyReason: `Mutating tool ${spec.name} is forbidden in ${phase} phase to maintain determinism`,
      };
    }

    return { allowed: true };
  }

  private isToolAllowedInPhase(phase: ExecutionPhase, spec: ToolSpec): boolean {
    // If tool explicitly declares allowed phases, check that first
    if (spec.allowedPhases && spec.allowedPhases.length > 0) {
      return spec.allowedPhases.includes(phase);
    }

    // Default Phase Policy (Best Practices)
    switch (phase) {
      case Phase.CONTEXT:
      case Phase.SHRINK:
        // Allow read-only operations
        return spec.sideEffects.every(
          (se) => se === 'none' || se === 'fs_read' || se === 'git_read',
        );

      case Phase.VERIFY:
        // Allow process execution for tests/verification
        return true;

      case Phase.PREFLIGHT:
      case Phase.VALIDATE:
        // Allow read-only or low-risk validation
        return (
          spec.riskLevel !== 'high' &&
          !spec.sideEffects.includes('fs_write') &&
          !spec.sideEffects.includes('git_write')
        );

      case Phase.PLAN:
      case Phase.PATCH:
      case Phase.APPLY:
        // Default deny for mutation phases (controlled by host logic)
        return false;

      default:
        return false;
    }
  }
}
