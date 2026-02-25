import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  buildStructuredOutputState,
  loadJsonSchema,
} from '../../../../../src/cli/commands/run/structured-output.js';

const readFile = mock();
const stat = mock();

mock.module('fs/promises', () => ({
  readFile,
  stat,
}));

describe('loadJsonSchema', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('parses inline JSON schema', async () => {
    const schema = await loadJsonSchema({
      schema: JSON.stringify({ type: 'object', properties: { foo: { type: 'string' } } }),
      repoPath: '/repo',
    });

    expect(schema).toMatchObject({
      type: 'object',
      properties: { foo: { type: 'string' } },
    });
  });

  it('rejects oversized inline schema input', async () => {
    const huge = JSON.stringify({ type: 'object', blob: 'x'.repeat(1024 * 1024) });

    await expect(
      loadJsonSchema({
        schema: huge,
        repoPath: '/repo',
      }),
    ).rejects.toThrow(/schema input/i);
  });

  it('loads schema from a repo-relative file path', async () => {
    stat.mockResolvedValue({ size: 32 });
    readFile.mockResolvedValue(JSON.stringify({ type: 'object' }));

    const schema = await loadJsonSchema({
      schema: 'schema.json',
      repoPath: '/repo',
    });

    expect(schema).toMatchObject({ type: 'object' });
  });

  it('rejects oversized schema file input', async () => {
    stat.mockResolvedValue({ size: 1024 * 1024 * 10 });
    readFile.mockResolvedValue(JSON.stringify({ type: 'object' }));

    await expect(
      loadJsonSchema({
        schema: 'schema.json',
        repoPath: '/repo',
      }),
    ).rejects.toThrow(/schema input/i);
  });
});

describe('buildStructuredOutputState', () => {
  it('includes budget summary in structured output payload', async () => {
    const state = await buildStructuredOutputState({
      outputFormat: 'json',
      jsonSchemaSpec: JSON.stringify({
        type: 'object',
        required: ['budget_summary'],
        properties: {
          budget_summary: {
            type: 'object',
            required: ['attempt_count', 'adjustment_count', 'alert_count', 'critical_drop_count'],
            properties: {
              attempt_count: { type: 'number' },
              adjustment_count: { type: 'number' },
              alert_count: { type: 'number' },
              critical_drop_count: { type: 'number' },
              avg_utilization: { type: 'number' },
              truncation_rate: { type: 'number' },
              success_rate: { type: 'number' },
            },
          },
        },
      }),
      result: {
        success: true,
        reason: 'ok',
        reasonCode: 'SUCCESS',
        attempts: 2,
        logs: [],
        changedFiles: ['a.ts'],
        budgetSummary: {
          attemptCount: 2,
          adjustmentCount: 1,
          alertCount: 1,
          criticalDropCount: 0,
          avgUtilization: 0.75,
          truncationRate: 0.5,
          successRate: 0.5,
        },
      },
      repoPath: '/repo',
      instruction: 'test',
      sessionIdForOutput: 'sid',
      exitCode: 0,
    });

    expect(state.ok).toBe(true);
    const candidate = state.candidate as Record<string, unknown>;
    expect(candidate.budget_summary).toEqual({
      attempt_count: 2,
      adjustment_count: 1,
      alert_count: 1,
      critical_drop_count: 0,
      avg_utilization: 0.75,
      truncation_rate: 0.5,
      success_rate: 0.5,
    });
  });
});
