import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  InMemorySubAgentController,
  createSubAgentController,
  type ToolCallEvent,
} from '../../../src/core/sub-agent/controller.js';
import type { SubAgentProfile, SubAgentStatus } from '../../../src/core/sub-agent/types.js';

const TEST_PROFILE: SubAgentProfile = {
  id: 'explorer',
  name: 'Explorer',
  role: 'explorer',
  description: 'Read-only exploration agent',
  allowedTools: ['fs.read', 'code.search'],
  readOnly: true,
  maxAttempts: 1,
  timeoutMs: 60_000,
  stratagem: 'investigator',
};

describe('InMemorySubAgentController', () => {
  let controller: InMemorySubAgentController;

  beforeEach(() => {
    controller = new InMemorySubAgentController();
  });

  describe('registerAgent', () => {
    it('registers a new agent', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      const agent = controller.getAgent('agent-1');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('agent-1');
      expect(agent!.profile).toBe(TEST_PROFILE);
      expect(agent!.status).toBe('working');
      expect(agent!.stopRequested).toBe(false);
      expect(agent!.logs).toEqual([]);
      expect(agent!.tokenUsage).toBe(0);
      expect(agent!.toolCallCount).toBe(0);
    });

    it('updates existing agent status on re-register', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.registerAgent('agent-1', TEST_PROFILE, 'terminated');
      const agent = controller.getAgent('agent-1');
      expect(agent!.status).toBe('terminated');
    });
  });

  describe('updateStatus', () => {
    it('updates agent status', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.updateStatus('agent-1', 'terminated', 'Task done');
      const agent = controller.getAgent('agent-1');
      expect(agent!.status).toBe('terminated');
      expect(agent!.summary).toBe('Task done');
    });

    it('appends status log entry', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.updateStatus('agent-1', 'terminated');
      const agent = controller.getAgent('agent-1');
      expect(agent!.logs).toHaveLength(1);
      expect(agent!.logs[0]).toContain('Status -> terminated');
    });

    it('no-ops for non-existent agent', () => {
      controller.updateStatus('non-existent', 'terminated');
      expect(controller.getAgent('non-existent')).toBeUndefined();
    });
  });

  describe('appendLog', () => {
    it('appends log messages', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.appendLog('agent-1', 'Starting task');
      controller.appendLog('agent-1', 'Processing files');
      const agent = controller.getAgent('agent-1');
      expect(agent!.logs).toHaveLength(2);
      expect(agent!.logs[0]).toContain('Starting task');
      expect(agent!.logs[1]).toContain('Processing files');
    });

    it('trims logs when exceeding LOG_HISTORY_LIMIT (200)', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      for (let i = 0; i < 210; i++) {
        controller.appendLog('agent-1', `Log entry ${i}`);
      }
      const agent = controller.getAgent('agent-1');
      expect(agent!.logs).toHaveLength(200);
      expect(agent!.logs[0]).toContain('Log entry 10');
      expect(agent!.logs[199]).toContain('Log entry 209');
    });

    it('no-ops for non-existent agent', () => {
      controller.appendLog('non-existent', 'message');
      // Should not throw
    });
  });

  describe('addTokenUsage', () => {
    it('accumulates token usage', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.addTokenUsage('agent-1', 100);
      controller.addTokenUsage('agent-1', 250);
      const agent = controller.getAgent('agent-1');
      expect(agent!.tokenUsage).toBe(350);
    });

    it('no-ops for non-existent agent', () => {
      controller.addTokenUsage('non-existent', 100);
      // Should not throw
    });
  });

  describe('recordToolCall', () => {
    it('increments tool call count', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.recordToolCall('agent-1', 'fs.read', 150, true);
      controller.recordToolCall('agent-1', 'code.search', 200, true);
      const agent = controller.getAgent('agent-1');
      expect(agent!.toolCallCount).toBe(2);
    });

    it('notifies tool call listeners', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      const listener = mock();
      controller.onToolCall(listener);
      controller.recordToolCall('agent-1', 'fs.read', 150, true);
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as ToolCallEvent;
      expect(event.type).toBe('tool.call.end');
      expect(event.agentId).toBe('agent-1');
      expect(event.toolName).toBe('fs.read');
      expect(event.durationMs).toBe(150);
      expect(event.success).toBe(true);
    });

    it('supports multiple listeners', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      const listener1 = mock();
      const listener2 = mock();
      controller.onToolCall(listener1);
      controller.onToolCall(listener2);
      controller.recordToolCall('agent-1', 'fs.read', 150, true);
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe removes listener', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      const listener = mock();
      const unsubscribe = controller.onToolCall(listener);
      unsubscribe();
      controller.recordToolCall('agent-1', 'fs.read', 150, true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('listAgents', () => {
    it('returns all registered agents', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.registerAgent('agent-2', TEST_PROFILE, 'terminated');
      const agents = controller.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id).sort()).toEqual(['agent-1', 'agent-2']);
    });

    it('returns empty array when no agents registered', () => {
      expect(controller.listAgents()).toEqual([]);
    });
  });

  describe('tailLogs', () => {
    it('returns last N log entries', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.appendLog('agent-1', 'log-1');
      controller.appendLog('agent-1', 'log-2');
      controller.appendLog('agent-1', 'log-3');
      const logs = controller.tailLogs('agent-1', 2);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain('log-2');
      expect(logs[1]).toContain('log-3');
    });

    it('returns empty array for non-existent agent', () => {
      expect(controller.tailLogs('non-existent', 10)).toEqual([]);
    });
  });

  describe('requestStop / isStopRequested', () => {
    it('requests stop for an agent', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      expect(controller.requestStop('agent-1')).toBe(true);
      expect(controller.isStopRequested('agent-1')).toBe(true);
    });

    it('returns true if stop already requested', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.requestStop('agent-1');
      expect(controller.requestStop('agent-1')).toBe(true);
    });

    it('returns false for non-existent agent', () => {
      expect(controller.requestStop('non-existent')).toBe(false);
    });

    it('isStopRequested returns false for non-existent agent', () => {
      expect(controller.isStopRequested('non-existent')).toBe(false);
    });

    it('appends stop log entry', () => {
      controller.registerAgent('agent-1', TEST_PROFILE, 'working');
      controller.requestStop('agent-1');
      const agent = controller.getAgent('agent-1');
      expect(agent!.logs.some((l) => l.includes('Stop requested'))).toBe(true);
    });
  });
});

describe('createSubAgentController', () => {
  it('returns an InMemorySubAgentController instance', () => {
    const controller = createSubAgentController();
    expect(controller).toBeInstanceOf(InMemorySubAgentController);
  });
});
