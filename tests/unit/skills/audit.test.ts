import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  clearAuditTrail,
  getAuditTrail,
} from '../../../src/core/observability/audit-trail.js';
import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import {
  SkillAuditEvent,
  emitSkillAuditEvent,
  generateSkillTraceId,
  hashSkillArgs,
} from '../../../src/core/skills/audit.js';

describe('Skill Audit Events (Unit)', () => {
  beforeEach(() => {
    clearAuditTrail();
    // Ensure a logger is available for audit emission
    if (!tryGetLogger()) {
      setLogger(createLogger({ silent: true }));
    }
  });

  afterEach(() => {
    clearAuditTrail();
  });

  describe('SkillAuditEvent interface coverage', () => {
    it('should emit SKILL_EXECUTION_START with all required fields', () => {
      const event: SkillAuditEvent = {
        type: 'SKILL_EXECUTION_START',
        skillId: 'test-skill',
        route: 'slash-governed',
        runnerClass: 'MicroTaskRunner',
        commandCount: 3,
        authorizationMode: 'blocking',
        argsHash: 'abc123',
        traceId: 'skill-test-skill-1234-deadbeef',
      };

      emitSkillAuditEvent(event);

      const trail = getAuditTrail();
      expect(trail.length).toBe(1);
      expect(trail[0].action).toBe('SKILL_EXECUTION_START');
      expect(trail[0].details).toMatchObject({
        skillId: 'test-skill',
        route: 'slash-governed',
        runnerClass: 'MicroTaskRunner',
        commandCount: 3,
        authorizationMode: 'blocking',
        argsHash: 'abc123',
        traceId: 'skill-test-skill-1234-deadbeef',
      });
    });

    it('should emit SKILL_EXECUTION_END with durationMs', () => {
      const event: SkillAuditEvent = {
        type: 'SKILL_EXECUTION_END',
        skillId: 'my-skill',
        route: 'tool-bridge',
        runnerClass: 'MicroTaskRunner',
        commandCount: 1,
        authorizationMode: 'blocking',
        traceId: 'skill-my-skill-5678-cafebabe',
        durationMs: 150,
      };

      emitSkillAuditEvent(event);

      const trail = getAuditTrail();
      expect(trail.length).toBe(1);
      expect(trail[0].action).toBe('SKILL_EXECUTION_END');
      expect(trail[0].details).toMatchObject({
        route: 'tool-bridge',
        durationMs: 150,
      });
    });

    it('should emit SKILL_EXECUTION_DENIED with denyReason and denySource', () => {
      const event: SkillAuditEvent = {
        type: 'SKILL_EXECUTION_DENIED',
        skillId: 'dangerous-skill',
        route: 'slash-governed',
        runnerClass: 'MicroTaskRunner',
        commandCount: 2,
        authorizationMode: 'blocking',
        traceId: 'skill-dangerous-skill-9999-abcd1234',
        denyReason: 'POLICY_DENIED',
        denySource: 'policy',
        durationMs: 10,
      };

      emitSkillAuditEvent(event);

      const trail = getAuditTrail();
      expect(trail.length).toBe(1);
      expect(trail[0].action).toBe('SKILL_EXECUTION_DENIED');
      expect(trail[0].details).toMatchObject({
        denyReason: 'POLICY_DENIED',
        denySource: 'policy',
      });
    });
  });

  describe('emitSkillAuditEvent severity', () => {
    it('should use high severity for DENIED events', () => {
      emitSkillAuditEvent({
        type: 'SKILL_EXECUTION_DENIED',
        skillId: 's1',
        route: 'slash-governed',
        runnerClass: 'MicroTaskRunner',
        commandCount: 0,
        authorizationMode: 'blocking',
        traceId: 'trace-1',
        denyReason: 'AUTH_REQUIRED',
        denySource: 'authorization',
      });

      const trail = getAuditTrail();
      expect(trail[0].severity).toBe('high');
    });

    it('should use low severity for START and END events', () => {
      emitSkillAuditEvent({
        type: 'SKILL_EXECUTION_START',
        skillId: 's1',
        route: 'tool-bridge',
        runnerClass: 'MicroTaskRunner',
        commandCount: 1,
        authorizationMode: 'blocking',
        traceId: 'trace-2',
      });

      emitSkillAuditEvent({
        type: 'SKILL_EXECUTION_END',
        skillId: 's1',
        route: 'tool-bridge',
        runnerClass: 'MicroTaskRunner',
        commandCount: 1,
        authorizationMode: 'blocking',
        traceId: 'trace-2',
        durationMs: 50,
      });

      const trail = getAuditTrail();
      expect(trail[0].severity).toBe('low');
      expect(trail[1].severity).toBe('low');
    });
  });

  describe('hashSkillArgs', () => {
    it('should return undefined for empty string', () => {
      expect(hashSkillArgs('')).toBeUndefined();
    });

    it('should return a 16-char hex hash for non-empty args', () => {
      const hash = hashSkillArgs('some arguments');
      expect(hash).toBeDefined();
      expect(hash!.length).toBe(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should produce different hashes for different args', () => {
      const h1 = hashSkillArgs('arg1');
      const h2 = hashSkillArgs('arg2');
      expect(h1).not.toBe(h2);
    });

    it('should produce the same hash for the same args', () => {
      const h1 = hashSkillArgs('same-args');
      const h2 = hashSkillArgs('same-args');
      expect(h1).toBe(h2);
    });
  });

  describe('generateSkillTraceId', () => {
    it('should start with skill- prefix and contain the skillId', () => {
      const traceId = generateSkillTraceId('my-skill');
      expect(traceId).toMatch(/^skill-my-skill-/);
    });

    it('should generate unique trace IDs', () => {
      const id1 = generateSkillTraceId('s');
      const id2 = generateSkillTraceId('s');
      expect(id1).not.toBe(id2);
    });
  });
});
