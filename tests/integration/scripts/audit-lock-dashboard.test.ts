import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  buildLockDashboardReport,
  exceedsTimeoutThreshold,
  renderLockDashboardText,
} from '../../../scripts/audit-lock-dashboard.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('audit lock dashboard', () => {
  it('aggregates lock events from jsonl and audit json', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lock-dashboard-'));
    tempDirs.push(root);
    const auditDir = path.join(root, '.salmonloop', 'runtime', 'audit');
    await mkdir(auditDir, { recursive: true });

    await writeFile(
      path.join(auditDir, 'audit-1.events.jsonl'),
      [
        JSON.stringify({
          action: 'checkpoint.manifest.lock.acquire_timeout',
          details: { repoPathHash: 'repo-a' },
          timestamp: '2026-03-04T10:00:00.000Z',
        }),
        JSON.stringify({
          action: 'checkpoint.manifest.lock.stale_reclaimed',
          details: { repoPathHash: 'repo-a' },
          timestamp: '2026-03-04T10:01:00.000Z',
        }),
        JSON.stringify({
          action: 'acp.session.lock.acquire_timeout',
          details: { lockPath: '/tmp/sessions.v1.json.lock' },
          timestamp: '2026-03-04T10:02:00.000Z',
        }),
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      path.join(auditDir, 'audit-1.json'),
      JSON.stringify({
        context: {
          auditTrail: [
            {
              action: 'checkpoint.manifest.lock.acquire_timeout',
              details: { repoPathHash: 'repo-b' },
              timestamp: '2026-03-04T10:03:00.000Z',
            },
          ],
        },
      }),
      'utf8',
    );

    const report = await buildLockDashboardReport(auditDir);
    expect(report.filesScanned).toBe(2);
    expect(report.matchedEvents).toBe(4);
    expect(report.timeoutEvents).toBe(3);
    expect(report.byAction['checkpoint.manifest.lock.acquire_timeout']).toBe(2);
    expect(report.byRepo['repo-a']?.total).toBe(2);
    expect(report.byRepo['repo-b']?.total).toBe(1);
    expect(report.byRepo.unknown?.total).toBe(1);

    const text = renderLockDashboardText(report);
    expect(text.includes('[lock-dashboard] by action:')).toBe(true);
    expect(text.includes('checkpoint.manifest.lock.acquire_timeout')).toBe(true);
    expect(exceedsTimeoutThreshold(report, 2)).toBe(true);
    expect(exceedsTimeoutThreshold(report, 3)).toBe(false);
  });

  it('filters events by sinceMs window', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lock-dashboard-since-'));
    tempDirs.push(root);
    const auditDir = path.join(root, '.salmonloop', 'runtime', 'audit');
    await mkdir(auditDir, { recursive: true });

    await writeFile(
      path.join(auditDir, 'audit-2.events.jsonl'),
      [
        JSON.stringify({
          action: 'checkpoint.manifest.lock.acquire_timeout',
          details: { repoPathHash: 'repo-a' },
          timestamp: '2026-03-04T09:00:00.000Z',
        }),
        JSON.stringify({
          action: 'checkpoint.manifest.lock.stale_reclaimed',
          details: { repoPathHash: 'repo-a' },
          timestamp: '2026-03-04T11:00:00.000Z',
        }),
      ].join('\n'),
      'utf8',
    );

    const report = await buildLockDashboardReport(auditDir, {
      sinceMs: Date.parse('2026-03-04T10:30:00.000Z'),
    });
    expect(report.matchedEvents).toBe(1);
    expect(report.byAction['checkpoint.manifest.lock.stale_reclaimed']).toBe(1);
  });
});
