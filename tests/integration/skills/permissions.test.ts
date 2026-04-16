import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillPermissionManager } from '../../../src/core/skills/permissions.js';

describe('SkillPermissionManager', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-perm-'));
    filePath = path.join(tmpDir, 'skill-permissions.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isAllowed', () => {
    it('returns false when no policies exist', () => {
      const mgr = new SkillPermissionManager(filePath);
      expect(mgr.isAllowed('my-skill')).toBe(false);
    });

    it('returns true for exact match policy', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'deploy-tool',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      expect(mgr.isAllowed('deploy-tool')).toBe(true);
      expect(mgr.isAllowed('deploy-tool-v2')).toBe(false);
    });

    it('returns true for prefix match policy', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'org-',
        kind: 'prefix',
        grantedBy: 'admin',
        grantedAt: new Date().toISOString(),
      });
      expect(mgr.isAllowed('org-deploy')).toBe(true);
      expect(mgr.isAllowed('org-lint')).toBe(true);
      expect(mgr.isAllowed('other-skill')).toBe(false);
    });

    it('handles multiple policies (exact + prefix)', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'special-skill',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      mgr.grant({
        pattern: 'team-',
        kind: 'prefix',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      expect(mgr.isAllowed('special-skill')).toBe(true);
      expect(mgr.isAllowed('team-deploy')).toBe(true);
      expect(mgr.isAllowed('unknown')).toBe(false);
    });
  });

  describe('grant', () => {
    it('deduplicates by pattern+kind and updates provenance', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'my-skill',
        kind: 'exact',
        grantedBy: 'user-a',
        grantedAt: '2024-01-01T00:00:00Z',
      });
      mgr.grant({
        pattern: 'my-skill',
        kind: 'exact',
        grantedBy: 'user-b',
        grantedAt: '2024-06-01T00:00:00Z',
      });

      const policies = mgr.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].grantedBy).toBe('user-b');
      expect(policies[0].grantedAt).toBe('2024-06-01T00:00:00Z');
    });

    it('allows same pattern with different kinds', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'deploy',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      mgr.grant({
        pattern: 'deploy',
        kind: 'prefix',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });

      const policies = mgr.getPolicies();
      expect(policies).toHaveLength(2);
    });
  });

  describe('revoke', () => {
    it('removes all policies matching the skill id pattern', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'to-remove',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      mgr.grant({
        pattern: 'to-keep',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });

      mgr.revoke('to-remove');

      expect(mgr.isAllowed('to-remove')).toBe(false);
      expect(mgr.isAllowed('to-keep')).toBe(true);
      expect(mgr.getPolicies()).toHaveLength(1);
    });

    it('is a no-op when skill id does not match any policy', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'existing',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });

      mgr.revoke('nonexistent');

      expect(mgr.getPolicies()).toHaveLength(1);
    });
  });

  describe('persistence', () => {
    it('persists policies to JSON and reloads them', () => {
      const mgr1 = new SkillPermissionManager(filePath);
      mgr1.grant({
        pattern: 'persisted-skill',
        kind: 'exact',
        grantedBy: 'cli',
        grantedAt: '2024-03-15T10:00:00Z',
      });
      mgr1.grant({
        pattern: 'org-',
        kind: 'prefix',
        grantedBy: 'admin',
        grantedAt: '2024-03-15T11:00:00Z',
      });

      // Create a new manager from the same file — should reload
      const mgr2 = new SkillPermissionManager(filePath);
      expect(mgr2.isAllowed('persisted-skill')).toBe(true);
      expect(mgr2.isAllowed('org-deploy')).toBe(true);
      expect(mgr2.isAllowed('unknown')).toBe(false);

      const policies = mgr2.getPolicies();
      expect(policies).toHaveLength(2);
      expect(policies[0].grantedBy).toBe('cli');
    });

    it('creates parent directories if they do not exist', () => {
      const nested = path.join(tmpDir, 'deep', 'nested', 'permissions.json');
      const mgr = new SkillPermissionManager(nested);
      mgr.grant({
        pattern: 'test',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });

      expect(fs.existsSync(nested)).toBe(true);
    });

    it('starts with empty allowlist when file does not exist', () => {
      const mgr = new SkillPermissionManager(path.join(tmpDir, 'nonexistent.json'));
      expect(mgr.getPolicies()).toHaveLength(0);
      expect(mgr.isAllowed('anything')).toBe(false);
    });

    it('starts with empty allowlist when file has invalid JSON', () => {
      fs.writeFileSync(filePath, 'not valid json', 'utf-8');
      const mgr = new SkillPermissionManager(filePath);
      expect(mgr.getPolicies()).toHaveLength(0);
    });

    it('starts with empty allowlist when file has wrong version', () => {
      fs.writeFileSync(filePath, JSON.stringify({ version: 99, policies: [] }), 'utf-8');
      const mgr = new SkillPermissionManager(filePath);
      expect(mgr.getPolicies()).toHaveLength(0);
    });

    it('persists revocations', () => {
      const mgr1 = new SkillPermissionManager(filePath);
      mgr1.grant({
        pattern: 'a',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      mgr1.grant({
        pattern: 'b',
        kind: 'exact',
        grantedBy: 'user',
        grantedAt: new Date().toISOString(),
      });
      mgr1.revoke('a');

      const mgr2 = new SkillPermissionManager(filePath);
      expect(mgr2.isAllowed('a')).toBe(false);
      expect(mgr2.isAllowed('b')).toBe(true);
    });
  });

  describe('provenance tracking', () => {
    it('stores grantedBy and grantedAt in persisted file', () => {
      const mgr = new SkillPermissionManager(filePath);
      mgr.grant({
        pattern: 'audited-skill',
        kind: 'exact',
        grantedBy: 'security-admin',
        grantedAt: '2024-07-01T12:00:00Z',
      });

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(raw.version).toBe(1);
      expect(raw.policies).toHaveLength(1);
      expect(raw.policies[0].grantedBy).toBe('security-admin');
      expect(raw.policies[0].grantedAt).toBe('2024-07-01T12:00:00Z');
    });
  });
});
