import { mkdtemp, rm, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { gunzip, gzip } from 'zlib';

import { afterEach, describe, expect, it } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../../src/core/observability/audit-trail.js';
import { ChatSessionManager } from '../../../../src/core/session/manager.js';
import { SessionReplacementPreviewProvider } from '../../../../src/core/session/replacement-preview-provider.js';

const tempRoots: string[] = [];
const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const originalResumeRepairFlag = process.env.SALMONLOOP_RESUME_REPAIR_V1;

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-archive-'));
  tempRoots.push(root);
  return root;
}

describe('ChatSessionManager archive lifecycle', () => {
  afterEach(async () => {
    clearAuditTrail();
    if (originalResumeRepairFlag === undefined) {
      delete process.env.SALMONLOOP_RESUME_REPAIR_V1;
    } else {
      process.env.SALMONLOOP_RESUME_REPAIR_V1 = originalResumeRepairFlag;
    }

    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists archived sessions with metadata sorted by archive time', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const first = await manager.create('First Session');
    manager.addMessage({
      role: 'user',
      content: 'first request',
      timestamp: Date.now(),
    });
    await manager.save();
    await manager.archiveSession(first);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await manager.create('Second Session');
    manager.addMessage({
      role: 'user',
      content: 'second request',
      timestamp: Date.now(),
    });
    await manager.save();
    await manager.archiveSession(second);

    const archived = await manager.listArchivedSessions();

    expect(archived).toHaveLength(2);
    expect(archived[0]).toMatchObject({
      id: second.meta.id,
      name: 'Second Session',
    });
    expect(archived[1]).toMatchObject({
      id: first.meta.id,
      name: 'First Session',
    });
    expect(archived[0]!.archivedAt).toBeGreaterThanOrEqual(archived[1]!.archivedAt);
  });

  it('restores a session from archive and persists it back to active storage', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Recover Me');
    manager.addMessage({
      role: 'user',
      content: 'please restore me',
      timestamp: Date.now(),
    });
    manager.addIteration({
      attempt: 1,
      plan: null,
      patch: null,
      contextSummary: 'Initial attempt',
    });
    manager.updateChatFlowMode('debug');
    await manager.save();
    await manager.archiveSession(session);

    const activeSessionFile = join(
      repoPath,
      '.salmonloop',
      'chat-sessions',
      `${session.meta.id}.json`,
    );
    await unlink(activeSessionFile);

    const restored = await manager.restoreFromArchive(session.meta.id.slice(0, 8));

    expect(restored).not.toBeNull();
    expect(restored?.meta.id).toBe(session.meta.id);
    expect(restored?.meta.name).toBe('Recover Me');
    expect(restored?.meta.repoPath).toBe(repoPath);
    expect(restored?.meta.chatState?.flowMode).toBe('debug');
    expect(restored?.messages.length).toBeGreaterThan(0);
    expect(restored?.meta.resumeRepairState).toBeDefined();
    expect(manager.getChatFlowMode()).toBe('debug');

    const sessions = await manager.listSessions();
    expect(sessions.some((item) => item.id === session.meta.id)).toBe(true);
  });

  it('can disable resume repair pipeline and use legacy restore path', async () => {
    process.env.SALMONLOOP_RESUME_REPAIR_V1 = '0';

    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Legacy Restore');
    manager.addMessage({
      role: 'user',
      content: 'legacy restore',
      timestamp: Date.now(),
    });
    manager.updateChatFlowMode('review');
    await manager.save();
    await manager.archiveSession(session);

    const restored = await manager.restoreFromArchive(session.meta.id);

    expect(restored).not.toBeNull();
    expect(restored?.meta.id).toBe(session.meta.id);
    expect(restored?.meta.chatState?.flowMode).toBe('review');
    expect(restored?.meta.resumeRepairState).toBeUndefined();
    expect(manager.getChatFlowMode()).toBe('review');
  });

  it('emits resume repair observability metrics for repaired restores', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Observed Restore');
    manager.freezeReplacementDecision({
      toolResultId: 'tool-result-1',
      decision: 'replaced',
      preview: 'preview text',
      sourceArtifactHandle: 's8p://artifact/verify-1',
      frozenAt: 1_710_000_000_003,
    });
    await manager.save();
    await manager.archiveSession(session);

    const restored = await manager.restoreFromArchive(session.meta.id);

    expect(restored).not.toBeNull();
    const event = getAuditTrail().find(
      (entry) => entry.action === 'session.resume_repair.completed',
    );
    expect(event).toBeDefined();
    expect(event?.details).toMatchObject({
      mode: 'repair_v1',
      success: true,
      metric: 'repair_violation_rate',
      repairViolationCount: 0,
      replacementReuseHitCount: 1,
      replacementReuseMetric: 'replacement_reuse_hit_rate',
    });
  });

  it('emits resume repair violation metrics when repaired restore fails closed', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Observed Failure');
    await manager.save();
    await manager.archiveSession(session);

    const archivePath = join(
      repoPath,
      '.salmonloop',
      'compressed-sessions',
      `${session.meta.id}.mpack.gz`,
    );
    const encoded = await Bun.file(archivePath).text();
    const bytes = Buffer.from(encoded, 'base64');
    const decompressed = await gunzipAsync(bytes);
    const payload = JSON.parse(decompressed.toString('utf8')) as any;
    payload.meta.id = '';
    const recompressed = await gzipAsync(Buffer.from(JSON.stringify(payload), 'utf8'));
    await Bun.write(archivePath, Buffer.from(recompressed).toString('base64'));

    const restored = await manager.restoreFromArchive(session.meta.id);

    expect(restored).toBeNull();
    const event = getAuditTrail().find(
      (entry) => entry.action === 'session.resume_repair.completed',
    );
    expect(event).toBeDefined();
    expect(event?.details).toMatchObject({
      mode: 'repair_v1',
      success: false,
      metric: 'repair_violation_rate',
      repairViolationCount: 1,
    });
  });

  it('restores archived artifact state for later request rehydration', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Artifact Restore');
    manager.mergeArtifactState({
      verifyArtifact: {
        handle: 's8p://artifact/verify-restored',
        mimeType: 'text/plain',
        sha256: 'verify-restored',
        size: 123,
      },
      recentReadArtifacts: [
        {
          path: 'src/restored.ts',
          artifact: {
            handle: 's8p://artifact/read-restored',
            mimeType: 'text/plain',
            sha256: 'read-restored',
            size: 45,
          },
        },
      ],
    });
    await manager.save();
    await manager.archiveSession(session);

    const restored = await manager.restoreFromArchive(session.meta.id);

    expect(restored).not.toBeNull();
    expect(manager.getArtifactState()).toEqual(
      expect.objectContaining({
        verifyArtifact: expect.objectContaining({
          handle: 's8p://artifact/verify-restored',
        }),
        recentReadArtifacts: [
          expect.objectContaining({
            path: 'src/restored.ts',
            artifact: expect.objectContaining({
              handle: 's8p://artifact/read-restored',
            }),
          }),
        ],
      }),
    );
  });

  it('returns null when archive id is not found', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const restored = await manager.restoreFromArchive('missing-archive-id');
    expect(restored).toBeNull();
  });

  it('fails closed when archived payload is corrupt', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Corrupt Archive');
    await manager.save();
    await manager.archiveSession(session);

    const archivePath = join(
      repoPath,
      '.salmonloop',
      'compressed-sessions',
      `${session.meta.id}.mpack.gz`,
    );
    await Bun.write(archivePath, 'corrupted-base64');

    const restored = await manager.restoreFromArchive(session.meta.id);
    expect(restored).toBeNull();
    await expect(manager.load(session.meta.id)).resolves.not.toBeNull();
  });

  it('does not delete the original session if archiveSession fails during auto cleanup', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Auto Cleanup Fail Test');
    await manager.save();

    // Force the score below threshold to ensure it gets selected for archiving
    manager.getPruningStrategy = () => ({ maxAgeDays: 0, maxSessions: 0, autoPrune: true } as any);

    // Override archiveSession to always fail
    manager.archiveSession = async () => {
      throw new Error('Forced archive failure');
    };

    await manager.performAutoCleanup();

    // We expect the original file to still exist
    const sessions = await manager.listSessions();
    const found = sessions.find((s) => s.id === session.meta.id);

    expect(found).toBeDefined();
    // And performAutoCleanup might throw or swallow, but it shouldn't delete the session.
    // If your performAutoCleanup implementation catches errors, errorThrown might be false, that is fine.
  });

  it('fails closed without partial publication when boundary metadata is malformed', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Malformed Boundary');
    manager.addMessage({
      role: 'user',
      content: 'boundary test',
      timestamp: Date.now(),
    });
    await manager.save();
    await manager.archiveSession(session);

    const archivePath = join(
      repoPath,
      '.salmonloop',
      'compressed-sessions',
      `${session.meta.id}.mpack.gz`,
    );
    const encoded = await Bun.file(archivePath).text();
    const bytes = Buffer.from(encoded, 'base64');
    const decompressed = await gunzipAsync(bytes);
    const payload = JSON.parse(decompressed.toString('utf8')) as any;
    payload.meta.id = '';
    const recompressed = await gzipAsync(Buffer.from(JSON.stringify(payload), 'utf8'));
    await Bun.write(archivePath, Buffer.from(recompressed).toString('base64'));

    const activeSessionFile = join(
      repoPath,
      '.salmonloop',
      'chat-sessions',
      `${session.meta.id}.json`,
    );
    await unlink(activeSessionFile);

    const restored = await manager.restoreFromArchive(session.meta.id);
    expect(restored).toBeNull();

    const sessions = await manager.listSessions();
    expect(sessions.some((item) => item.name === 'Malformed Boundary')).toBe(false);
  });

  it('keeps frozen replacement decision byte-stable after resume and blocks policy flip', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Frozen Replacement Resume');
    manager.freezeReplacementDecision({
      toolResultId: 'tool-result-stable',
      decision: 'replaced',
      preview: 'stable preview bytes',
      sourceArtifactHandle: 's8p://artifact/preview-stable',
      frozenAt: 1_710_000_000_111,
    });
    await manager.save();
    await manager.archiveSession(session);

    const restored = await manager.restoreFromArchive(session.meta.id);
    expect(restored).not.toBeNull();

    manager.freezeReplacementDecision({
      toolResultId: 'tool-result-stable',
      decision: 'kept',
      preview: 'mutated preview bytes',
      sourceArtifactHandle: 's8p://artifact/preview-mutated',
      frozenAt: 1_710_000_000_999,
    });

    const replacementState = manager.getReplacementState();
    const entry = replacementState?.entries['tool-result-stable'];
    expect(entry).toBeDefined();
    expect(entry?.decision).toBe('replaced');
    expect(entry?.preview).toBe('stable preview bytes');
    expect(entry?.sourceArtifactHandle).toBe('s8p://artifact/preview-stable');

    const provider = new SessionReplacementPreviewProvider(replacementState);
    const hints = provider.getPreviewHints();
    expect(hints).toEqual([
      {
        label: 'Tool result preview: tool-result-stable',
        artifact: {
          handle: 's8p://artifact/preview-stable',
          mimeType: 'application/json',
          sha256: 'tool-result-stable',
          size: 'stable preview bytes'.length,
        },
      },
    ]);
  });
});
