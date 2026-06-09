/**
 * SubAgentTeam — lightweight task board for parallel sub-agent coordination.
 *
 * Multiple sub-agents can claim tasks/files to avoid duplicate work.
 * Claims are advisory (not enforced) — the team board is a shared
 * declaration board, not a mutex.
 */

export interface ClaimEntry {
  taskKey: string;
  claimedBy: string;
  claimedAt: number;
}

export class SubAgentTeam {
  private readonly board = new Map<string, { claimedBy: string; claimedAt: number }>();

  /**
   * Attempt to claim a task key. Returns true if the claim succeeded
   * (key was unclaimed), false if already claimed by another agent.
   * Re-claiming by the same agent is idempotent (returns true).
   */
  claim(taskKey: string, agentId: string): boolean {
    const existing = this.board.get(taskKey);
    if (existing && existing.claimedBy !== agentId) {
      return false;
    }
    this.board.set(taskKey, { claimedBy: agentId, claimedAt: Date.now() });
    return true;
  }

  /**
   * Release a claim (e.g., on completion or failure).
   */
  release(taskKey: string, agentId: string): boolean {
    const existing = this.board.get(taskKey);
    if (!existing || existing.claimedBy !== agentId) {
      return false;
    }
    this.board.delete(taskKey);
    return true;
  }

  /**
   * Check if a task key is already claimed by someone else.
   */
  isClaimed(taskKey: string, excludeAgent?: string): boolean {
    const existing = this.board.get(taskKey);
    if (!existing) return false;
    return existing.claimedBy !== excludeAgent;
  }

  /**
   * List all current claims.
   */
  listClaims(): ClaimEntry[] {
    return Array.from(this.board.entries()).map(([taskKey, entry]) => ({
      taskKey,
      claimedBy: entry.claimedBy,
      claimedAt: entry.claimedAt,
    }));
  }

  /**
   * Get all claims for a specific agent.
   */
  getAgentClaims(agentId: string): ClaimEntry[] {
    const claims: ClaimEntry[] = [];
    for (const [taskKey, entry] of this.board) {
      if (entry.claimedBy === agentId) {
        claims.push({ taskKey, claimedBy: entry.claimedBy, claimedAt: entry.claimedAt });
      }
    }
    return claims;
  }

  /**
   * Clear all claims for a specific agent (e.g., on termination).
   */
  releaseAll(agentId: string): number {
    let released = 0;
    for (const [key, entry] of this.board) {
      if (entry.claimedBy === agentId) {
        this.board.delete(key);
        released++;
      }
    }
    return released;
  }
}

// Global team registry — teams live for the duration of the parent session
const teams = new Map<string, SubAgentTeam>();

/** Get an existing team or create a new one. Teams are keyed by teamId. */
export function getOrCreateTeam(teamId: string): SubAgentTeam {
  let team = teams.get(teamId);
  if (!team) {
    team = new SubAgentTeam();
    teams.set(teamId, team);
  }
  return team;
}

/** Remove a team from the global registry. Returns false if not found. */
export function removeTeam(teamId: string): boolean {
  return teams.delete(teamId);
}

/** Remove all teams from the global registry. */
export function clearAllTeams(): void {
  teams.clear();
}
