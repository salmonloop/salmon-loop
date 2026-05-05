import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';
import { JSDOM } from 'jsdom';

const {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  advanceTimersToNextTimer,
  runAllTimers,
  runOnlyPendingTimers,
  clearAllTimers,
} = jest;

Object.defineProperty(mock, 'fn', { value: mock, writable: false });
import * as auditTrail from '../../src/core/observability/audit-trail.js';
import type { AuditTrailEvent } from '../../src/core/observability/audit-trail.js';
import { tryGetLogger } from '../../src/core/observability/logger.js';

const silentConsoleTargets: Array<keyof Console> = ['log', 'info', 'warn', 'error'];
let consoleSpies: Array<ReturnType<typeof spyOn>> = [];
let previousLoggerSilent: boolean | null = null;

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
  spyOn,
  test,
  useFakeTimers,
  useRealTimers,
};

export type MockFunction<T extends (...args: unknown[]) => unknown> = ReturnType<typeof mock<T>>;
export type MockedModuleFactory<T> = () => T;

export function ensureDom(windowUrl = 'http://localhost/') {
  const globalRecord = globalThis as Record<string, unknown>;
  if (typeof globalRecord.document !== 'undefined') return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: windowUrl });
  globalRecord.window = dom.window;
  globalRecord.document = dom.window.document;
  globalRecord.navigator = dom.window.navigator;
  globalRecord.HTMLElement = dom.window.HTMLElement;
  globalRecord.Node = dom.window.Node;
  globalRecord.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
}

export function ensureUiModuleStubs() {
  mock.module('ink', () => ({
    Box: ({ children }: { children?: unknown }) => children ?? null,
    Text: ({ children }: { children?: unknown }) => children ?? null,
    Static: ({
      items,
      children,
    }: {
      items?: unknown[];
      children: (item: unknown, index: number) => unknown;
    }) => (Array.isArray(items) ? items.map((item, index) => children(item, index)) : null),
    useInput: () => {},
    useStdout: () => ({ stdout: { columns: 120, rows: 30 } }),
    useStdin: () => ({
      stdin: process.stdin,
      setRawMode: () => {},
      isRawModeSupported: true,
    }),
  }));
  mock.module('ink-text-input', () => ({
    default: () => null,
  }));
}

export function ensureTestGlobals() {
  const globalRecord = globalThis as Record<string, unknown>;
  globalRecord.describe ??= describe;
  globalRecord.it ??= it;
  globalRecord.test ??= test;
  globalRecord.expect ??= expect;
  globalRecord.beforeEach ??= beforeEach;
  globalRecord.afterEach ??= afterEach;
  globalRecord.beforeAll ??= beforeAll;
  globalRecord.afterAll ??= afterAll;
  globalRecord.mock ??= mock;
  globalRecord.spyOn ??= spyOn;
  globalRecord.useFakeTimers ??= useFakeTimers;
  globalRecord.useRealTimers ??= useRealTimers;
  globalRecord.advanceTimersByTime ??= advanceTimersByTime;
  globalRecord.advanceTimersToNextTimer ??= advanceTimersToNextTimer;
  globalRecord.runAllTimers ??= runAllTimers;
  globalRecord.runOnlyPendingTimers ??= runOnlyPendingTimers;
  globalRecord.clearAllTimers ??= clearAllTimers;
  globalRecord.setSystemTime ??= setSystemTime;
}

export function muteConsoleOutputs() {
  if (consoleSpies.length > 0) return;
  for (const method of silentConsoleTargets) {
    const spy = spyOn(console, method as keyof Console);
    spy.mockImplementation(() => {});
    consoleSpies.push(spy);
  }
  const logger = tryGetLogger();
  if (logger && previousLoggerSilent === null && typeof logger.getSilent === 'function') {
    previousLoggerSilent = logger.getSilent();
    if (typeof logger.setSilent === 'function') {
      logger.setSilent(true);
    }
  }
}

export function restoreConsoleOutputs() {
  for (const spy of consoleSpies) {
    spy.mockRestore();
  }
  if (previousLoggerSilent !== null) {
    const logger = tryGetLogger();
    if (logger && typeof logger.setSilent === 'function') {
      logger.setSilent(previousLoggerSilent);
    }
    previousLoggerSilent = null;
  }
  consoleSpies = [];
}

export function clearMockState() {
  mock.restore();
  auditTrail.clearAuditTrail();
}

export async function withAuditCapture<Result>(
  callback: () => Result | Promise<Result>,
): Promise<{ result: Awaited<Result>; events: AuditTrailEvent[] }> {
  auditTrail.clearAuditTrail();
  const result = await callback();
  return { result, events: auditTrail.getAuditTrail() };
}

export async function captureLoggerAudit<Result>(
  callback: () => Result | Promise<Result>,
): Promise<{
  result: Awaited<Result>;
  events: AuditTrailEvent[];
  auditEntries: LoggerAuditEntry[];
}> {
  const logger = tryGetLogger();
  if (!logger) {
    throw new Error(
      'Logger is not initialized. captureLoggerAudit requires setLogger() in test setup.',
    );
  }
  const entries: LoggerAuditEntry[] = [];
  const originalAudit = logger.audit.bind(logger);
  logger.audit = (action: string, details: unknown, meta?: string | auditTrail.AuditTrailMeta) => {
    entries.push({ action, details, meta });
    return originalAudit(action, details, meta);
  };
  try {
    const captured = await withAuditCapture(callback);
    return { ...captured, auditEntries: [...entries] };
  } finally {
    logger.audit = originalAudit;
  }
}

export interface LoggerAuditEntry {
  action: string;
  details: unknown;
  meta?: string | auditTrail.AuditTrailMeta;
}
