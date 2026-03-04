import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LockAuditEvent {
  action: string;
  details?: Record<string, unknown>;
}

export interface LockDashboardReport {
  generatedAt: string;
  auditDir: string;
  filesScanned: number;
  matchedEvents: number;
  byAction: Record<string, number>;
  byRepo: Record<
    string,
    {
      total: number;
      byAction: Record<string, number>;
    }
  >;
}

const LOCK_ACTION_PATTERNS = [/^acp\.session\.lock\./, /^checkpoint\.manifest\.lock\./];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLockAction(action: string): boolean {
  return LOCK_ACTION_PATTERNS.some((pattern) => pattern.test(action));
}

function extractRepoDimension(event: LockAuditEvent): string {
  const details = event.details;
  if (!isRecord(details)) return 'unknown';
  const repoPathHash = details.repoPathHash;
  if (typeof repoPathHash === 'string' && repoPathHash.length > 0) {
    return repoPathHash;
  }
  return 'unknown';
}

function addCount(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function collectLockEventsFromJsonValue(raw: unknown): LockAuditEvent[] {
  if (!isRecord(raw)) return [];
  const out: LockAuditEvent[] = [];
  if (typeof raw.action === 'string' && isLockAction(raw.action)) {
    out.push({ action: raw.action, details: isRecord(raw.details) ? raw.details : undefined });
  }
  const context = raw.context;
  if (isRecord(context) && Array.isArray(context.auditTrail)) {
    for (const entry of context.auditTrail) {
      if (!isRecord(entry) || typeof entry.action !== 'string') continue;
      if (!isLockAction(entry.action)) continue;
      out.push({
        action: entry.action,
        details: isRecord(entry.details) ? entry.details : undefined,
      });
    }
  }
  return out;
}

async function readLockEventsFromFile(filePath: string): Promise<LockAuditEvent[]> {
  const content = await readFile(filePath, 'utf8');
  if (filePath.endsWith('.events.jsonl')) {
    const out: LockAuditEvent[] = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(...collectLockEventsFromJsonValue(JSON.parse(trimmed)));
      } catch {
        // skip malformed line
      }
    }
    return out;
  }
  try {
    return collectLockEventsFromJsonValue(JSON.parse(content));
  } catch {
    return [];
  }
}

export async function buildLockDashboardReport(auditDir: string): Promise<LockDashboardReport> {
  const resolvedAuditDir = path.resolve(auditDir);
  const entries = await readdir(resolvedAuditDir, { withFileTypes: true });
  const candidateFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (/^audit-.*\.events\.jsonl$/.test(entry.name) || /^audit-.*\.json$/.test(entry.name)),
    )
    .map((entry) => path.join(resolvedAuditDir, entry.name));

  const report: LockDashboardReport = {
    generatedAt: new Date().toISOString(),
    auditDir: resolvedAuditDir,
    filesScanned: candidateFiles.length,
    matchedEvents: 0,
    byAction: {},
    byRepo: {},
  };

  for (const filePath of candidateFiles) {
    const events = await readLockEventsFromFile(filePath);
    for (const event of events) {
      report.matchedEvents += 1;
      addCount(report.byAction, event.action);
      const repo = extractRepoDimension(event);
      if (!report.byRepo[repo]) {
        report.byRepo[repo] = { total: 0, byAction: {} };
      }
      report.byRepo[repo].total += 1;
      addCount(report.byRepo[repo].byAction, event.action);
    }
  }
  return report;
}

export function renderLockDashboardText(report: LockDashboardReport): string {
  const lines: string[] = [];
  lines.push(`[lock-dashboard] dir: ${report.auditDir}`);
  lines.push(`[lock-dashboard] files: ${report.filesScanned}`);
  lines.push(`[lock-dashboard] matched lock events: ${report.matchedEvents}`);
  lines.push('[lock-dashboard] by action:');
  for (const [action, count] of Object.entries(report.byAction).sort((a, b) => b[1] - a[1])) {
    lines.push(`  - ${action}: ${count}`);
  }
  lines.push('[lock-dashboard] by repo:');
  for (const [repo, item] of Object.entries(report.byRepo).sort(
    (a, b) => b[1].total - a[1].total,
  )) {
    lines.push(`  - ${repo}: ${item.total}`);
  }
  return lines.join('\n');
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dirFlagIndex = args.indexOf('--dir');
  const directory =
    dirFlagIndex >= 0 && args[dirFlagIndex + 1]
      ? args[dirFlagIndex + 1]
      : path.join(process.cwd(), '.salmonloop', 'runtime', 'audit');

  const report = await buildLockDashboardReport(directory);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderLockDashboardText(report)}\n`);
}

if (import.meta.main) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[lock-dashboard] failed: ${message}\n`);
    process.exitCode = 1;
  });
}
