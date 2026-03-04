import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LockAuditEvent {
  action: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface LockDashboardReport {
  generatedAt: string;
  auditDir: string;
  since?: string;
  filesScanned: number;
  matchedEvents: number;
  timeoutEvents: number;
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
const LOCK_TIMEOUT_ACTION_PATTERN = /\.lock\.acquire_timeout$/;

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
    out.push({
      action: raw.action,
      details: isRecord(raw.details) ? raw.details : undefined,
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : undefined,
    });
  }
  const context = raw.context;
  if (isRecord(context) && Array.isArray(context.auditTrail)) {
    for (const entry of context.auditTrail) {
      if (!isRecord(entry) || typeof entry.action !== 'string') continue;
      if (!isLockAction(entry.action)) continue;
      out.push({
        action: entry.action,
        details: isRecord(entry.details) ? entry.details : undefined,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
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

function shouldKeepBySince(event: LockAuditEvent, sinceMs?: number): boolean {
  if (!sinceMs) return true;
  if (!event.timestamp) return false;
  const eventMs = Date.parse(event.timestamp);
  if (!Number.isFinite(eventMs)) return false;
  return eventMs >= sinceMs;
}

export async function buildLockDashboardReport(
  auditDir: string,
  options: { sinceMs?: number } = {},
): Promise<LockDashboardReport> {
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
    since: options.sinceMs ? new Date(options.sinceMs).toISOString() : undefined,
    filesScanned: candidateFiles.length,
    matchedEvents: 0,
    timeoutEvents: 0,
    byAction: {},
    byRepo: {},
  };

  for (const filePath of candidateFiles) {
    const events = await readLockEventsFromFile(filePath);
    for (const event of events) {
      if (!shouldKeepBySince(event, options.sinceMs)) continue;
      report.matchedEvents += 1;
      addCount(report.byAction, event.action);
      if (LOCK_TIMEOUT_ACTION_PATTERN.test(event.action)) {
        report.timeoutEvents += 1;
      }
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
  if (report.since) {
    lines.push(`[lock-dashboard] since: ${report.since}`);
  }
  lines.push(`[lock-dashboard] files: ${report.filesScanned}`);
  lines.push(`[lock-dashboard] matched lock events: ${report.matchedEvents}`);
  lines.push(`[lock-dashboard] acquire_timeout events: ${report.timeoutEvents}`);
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

function parseNumberFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${name}: ${args[index + 1]}`);
  }
  return value;
}

function parseSinceMs(args: string[]): number | undefined {
  const sinceIndex = args.indexOf('--since');
  if (sinceIndex >= 0 && args[sinceIndex + 1]) {
    const parsed = Date.parse(args[sinceIndex + 1]);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid --since timestamp: ${args[sinceIndex + 1]}`);
    }
    return parsed;
  }
  const hours = parseNumberFlag(args, '--hours');
  if (hours === undefined) return undefined;
  return Date.now() - hours * 60 * 60 * 1000;
}

export function exceedsTimeoutThreshold(
  report: LockDashboardReport,
  maxTimeouts?: number,
): boolean {
  if (maxTimeouts === undefined) return false;
  return report.timeoutEvents > maxTimeouts;
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const sinceMs = parseSinceMs(args);
  const maxTimeouts = parseNumberFlag(args, '--max-timeouts');
  const dirFlagIndex = args.indexOf('--dir');
  const directory =
    dirFlagIndex >= 0 && args[dirFlagIndex + 1]
      ? args[dirFlagIndex + 1]
      : path.join(process.cwd(), '.salmonloop', 'runtime', 'audit');

  const report = await buildLockDashboardReport(directory, { sinceMs });
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderLockDashboardText(report)}\n`);
  }
  if (exceedsTimeoutThreshold(report, maxTimeouts)) {
    process.stderr.write(
      `[lock-dashboard] threshold exceeded: acquire_timeout=${report.timeoutEvents} > max=${maxTimeouts}\n`,
    );
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[lock-dashboard] failed: ${message}\n`);
    process.exitCode = 1;
  });
}
