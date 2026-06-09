import { beforeEach, describe, expect, it } from 'bun:test';

import {
  SubAgentTeam,
  getOrCreateTeam,
  removeTeam,
  clearAllTeams,
} from '../../../src/core/sub-agent/team.js';

describe('SubAgentTeam', () => {
  let team: SubAgentTeam;

  beforeEach(() => {
    team = new SubAgentTeam();
    clearAllTeams();
  });

  describe('claim', () => {
    it('returns true when claiming an unclaimed key', () => {
      expect(team.claim('file-a.ts', 'agent-1')).toBe(true);
    });

    it('returns false when key is already claimed by another agent', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.claim('file-a.ts', 'agent-2')).toBe(false);
    });

    it('returns true when re-claiming by the same agent (idempotent)', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.claim('file-a.ts', 'agent-1')).toBe(true);
    });

    it('allows different agents to claim different keys', () => {
      expect(team.claim('file-a.ts', 'agent-1')).toBe(true);
      expect(team.claim('file-b.ts', 'agent-2')).toBe(true);
    });
  });

  describe('release', () => {
    it('returns true when releasing own claim', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.release('file-a.ts', 'agent-1')).toBe(true);
    });

    it('returns false when releasing a claim owned by another agent', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.release('file-a.ts', 'agent-2')).toBe(false);
    });

    it('returns false when releasing an unclaimed key', () => {
      expect(team.release('file-a.ts', 'agent-1')).toBe(false);
    });

    it('allows re-claiming after release', () => {
      team.claim('file-a.ts', 'agent-1');
      team.release('file-a.ts', 'agent-1');
      expect(team.claim('file-a.ts', 'agent-2')).toBe(true);
    });
  });

  describe('isClaimed', () => {
    it('returns false for unclaimed key', () => {
      expect(team.isClaimed('file-a.ts')).toBe(false);
    });

    it('returns true for claimed key', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.isClaimed('file-a.ts')).toBe(true);
    });

    it('returns false when excluding the claiming agent', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.isClaimed('file-a.ts', 'agent-1')).toBe(false);
    });

    it('returns true when excluding a different agent', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.isClaimed('file-a.ts', 'agent-2')).toBe(true);
    });
  });

  describe('listClaims', () => {
    it('returns empty array when no claims exist', () => {
      expect(team.listClaims()).toEqual([]);
    });

    it('returns all claims', () => {
      team.claim('file-a.ts', 'agent-1');
      team.claim('file-b.ts', 'agent-2');
      const claims = team.listClaims();
      expect(claims).toHaveLength(2);
      expect(claims.map((c) => c.taskKey).sort()).toEqual(['file-a.ts', 'file-b.ts']);
    });

    it('includes claimedAt timestamp', () => {
      const before = Date.now();
      team.claim('file-a.ts', 'agent-1');
      const after = Date.now();
      const claims = team.listClaims();
      expect(claims[0].claimedAt).toBeGreaterThanOrEqual(before);
      expect(claims[0].claimedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('getAgentClaims', () => {
    it('returns claims for a specific agent', () => {
      team.claim('file-a.ts', 'agent-1');
      team.claim('file-b.ts', 'agent-1');
      team.claim('file-c.ts', 'agent-2');
      const claims = team.getAgentClaims('agent-1');
      expect(claims).toHaveLength(2);
      expect(claims.map((c) => c.taskKey).sort()).toEqual(['file-a.ts', 'file-b.ts']);
    });

    it('returns empty array for agent with no claims', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.getAgentClaims('agent-2')).toEqual([]);
    });
  });

  describe('releaseAll', () => {
    it('releases all claims for a specific agent', () => {
      team.claim('file-a.ts', 'agent-1');
      team.claim('file-b.ts', 'agent-1');
      team.claim('file-c.ts', 'agent-2');
      const released = team.releaseAll('agent-1');
      expect(released).toBe(2);
      expect(team.listClaims()).toHaveLength(1);
      expect(team.listClaims()[0].taskKey).toBe('file-c.ts');
    });

    it('returns 0 when agent has no claims', () => {
      team.claim('file-a.ts', 'agent-1');
      expect(team.releaseAll('agent-2')).toBe(0);
    });
  });
});

describe('Global team registry', () => {
  beforeEach(() => {
    clearAllTeams();
  });

  it('getOrCreateTeam creates a new team', () => {
    const team = getOrCreateTeam('team-alpha');
    expect(team).toBeInstanceOf(SubAgentTeam);
  });

  it('getOrCreateTeam returns existing team', () => {
    const team1 = getOrCreateTeam('team-alpha');
    const team2 = getOrCreateTeam('team-alpha');
    expect(team1).toBe(team2);
  });

  it('removeTeam removes a team', () => {
    getOrCreateTeam('team-alpha');
    expect(removeTeam('team-alpha')).toBe(true);
    // Next getOrCreate should create a new instance
    const newTeam = getOrCreateTeam('team-alpha');
    expect(newTeam).toBeInstanceOf(SubAgentTeam);
  });

  it('removeTeam returns false for non-existent team', () => {
    expect(removeTeam('non-existent')).toBe(false);
  });

  it('clearAllTeams removes all teams', () => {
    getOrCreateTeam('team-alpha');
    getOrCreateTeam('team-beta');
    clearAllTeams();
    // After clear, getOrCreate should create new instances
    const team = getOrCreateTeam('team-alpha');
    expect(team).toBeInstanceOf(SubAgentTeam);
  });
});
