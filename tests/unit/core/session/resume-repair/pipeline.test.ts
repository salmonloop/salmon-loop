import { describe, expect, it, mock } from 'bun:test';

import { createResumeRepairPipeline } from '../../../../../src/core/session/resume-repair/pipeline.js';

function createCompressedFixture() {
  return {
    meta: {
      id: 'session-1',
      name: 'Recovered',
      createdAt: 1,
      updatedAt: 2,
      importanceScore: 1,
      originalSize: 100,
      compressedSize: 10,
      compressionRatio: 90,
    },
    compressed: {
      summary: 'summary',
      summaryTokens: 1,
      keyMessages: [{ role: 'user', timestamp: 10, preview: 'hello', tokenCount: 1 }],
      keyIterations: [{ id: 'iter-1', outcome: 'success', timestamp: 10, summary: 'ok' }],
      stats: {
        totalMessages: 1,
        userMessages: 1,
        assistantMessages: 0,
        totalIterations: 1,
        successfulIterations: 1,
        totalTokens: { input: 1, output: 1 },
      },
    },
    accessInfo: {
      lastAccessed: 1,
      accessCount: 1,
      accessFrequency: 1,
    },
  };
}

describe('resume-repair pipeline', () => {
  it('reconstructs session from valid archive payload', async () => {
    const compressed = createCompressedFixture();
    const pipeline = createResumeRepairPipeline({
      compressedStore: {
        loadCompressed: mock(async () => compressed as any),
      },
      compressor: {
        decompressToSession: mock(async () => ({
          meta: {
            id: 'session-1',
            name: 'Recovered',
            createdAt: 1,
            updatedAt: 2,
          },
          messages: [{ role: 'user' as const, content: 'hello', timestamp: 10 }],
          iterations: [{ id: 'iter-1', outcome: 'success' as const, timestamp: 10, summary: 'ok' }],
        })),
      },
      repoPath: '/repo',
      now: () => 123,
    });

    const result = await pipeline.run({ archiveId: 'session-1', filename: 'session-1.mpack.gz' });
    expect(result.contractViolations).toHaveLength(0);
    expect(result.session?.meta.repoPath).toBe('/repo');
    expect(result.session?.messages[0]?.id).toBe('restored-msg-0');
  });

  it('fails closed when metadata is malformed', async () => {
    const pipeline = createResumeRepairPipeline({
      compressedStore: {
        loadCompressed: mock(async () => createCompressedFixture() as any),
      },
      compressor: {
        decompressToSession: mock(async () => ({
          meta: {
            id: '',
            name: 'Recovered',
            createdAt: 1,
            updatedAt: 2,
          },
          messages: [{ role: 'user' as const, content: 'hello', timestamp: 10 }],
          iterations: [],
        })),
      },
      repoPath: '/repo',
    });

    const result = await pipeline.run({ archiveId: 'bad', filename: 'bad.mpack.gz' });
    expect(result.session).toBeUndefined();
    expect(result.contractViolations.map((item) => item.code)).toContain(
      'MALFORMED_BOUNDARY_METADATA',
    );
  });

  it('runs startup hooks idempotently by key and fails closed on hook error', async () => {
    const hookRun = mock();
    const pipeline = createResumeRepairPipeline({
      compressedStore: {
        loadCompressed: mock(async () => createCompressedFixture() as any),
      },
      compressor: {
        decompressToSession: mock(async () => ({
          meta: {
            id: 'session-1',
            name: 'Recovered',
            createdAt: 1,
            updatedAt: 2,
          },
          messages: [{ role: 'user' as const, content: 'hello', timestamp: 10 }],
          iterations: [],
        })),
      },
      repoPath: '/repo',
      startupHooks: [
        {
          key: 'once',
          run: () => hookRun(),
        },
        {
          key: 'once',
          run: () => hookRun(),
        },
        {
          key: 'boom',
          run: () => {
            throw new Error('boom');
          },
        },
      ],
    });

    const result = await pipeline.run({ archiveId: 'session-1', filename: 'session-1.mpack.gz' });
    expect(hookRun).toHaveBeenCalledTimes(1);
    expect(result.session).toBeUndefined();
    expect(result.contractViolations.map((item) => item.code)).toContain('STARTUP_HOOK_FAILED');
  });

  it('fails closed when archive payload is missing', async () => {
    const pipeline = createResumeRepairPipeline({
      compressedStore: {
        loadCompressed: mock(async () => null),
      },
      compressor: {
        decompressToSession: mock(async () => {
          throw new Error('should not run');
        }),
      },
      repoPath: '/repo',
    });

    const result = await pipeline.run({ archiveId: 'missing', filename: 'missing.mpack.gz' });
    expect(result.session).toBeUndefined();
    expect(result.contractViolations.map((item) => item.code)).toContain('ARCHIVE_CORRUPTED');
  });
});
