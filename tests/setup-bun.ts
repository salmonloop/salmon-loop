import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  test,
  vi,
} from 'bun:test';
import { JSDOM } from 'jsdom';

type ViLike = {
  fn?: (...args: any[]) => any;
  mock?: (modulePath: string, factory?: (() => unknown) | (() => Promise<unknown>)) => unknown;
  mocked?: <T>(value: T) => T;
  hoisted?: <T>(factory: () => T) => T;
  isMockFunction?: (value: unknown) => boolean;
  stubEnv?: (key: string, value: string | undefined) => void;
  unstubAllEnvs?: () => void;
  stubGlobal?: (key: string, value: unknown) => void;
  unstubAllGlobals?: () => void;
  resetModules?: () => Promise<void> | void;
  importActual?: <T>(modulePath: string) => Promise<T>;
  doMock?: (modulePath: string, factory?: (() => unknown) | (() => Promise<unknown>)) => unknown;
  setSystemTime?: (when: string | number | Date) => void;
  advanceTimersByTime?: (ms: number) => unknown;
  advanceTimersToNextTimer?: () => unknown;
  getTimerCount?: () => number;
  runOnlyPendingTimers?: () => unknown;
  runAllTimers?: () => unknown;
  useRealTimers?: (...args: unknown[]) => unknown;
};

function ensureDom() {
  if (typeof (globalThis as any).document !== 'undefined') return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).navigator = dom.window.navigator;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
}

function ensureVitestCompat() {
  const viCompat = vi as unknown as ViLike;
  const globalWithVi = globalThis as { vi?: ViLike };
  globalWithVi.vi = viCompat;

  viCompat.mocked ??= <T>(value: T) => value;
  viCompat.hoisted ??= <T>(factory: () => T) => factory();
  viCompat.importActual ??= <T>(modulePath: string) => import(modulePath) as Promise<T>;
  viCompat.doMock ??= (modulePath, factory) => viCompat.mock?.(modulePath, factory);
  viCompat.isMockFunction ??= (value: unknown) => {
    if (typeof value !== 'function') return false;
    const maybeMock = value as {
      mock?: unknown;
      mockClear?: () => unknown;
      mockReset?: () => unknown;
      mockRestore?: () => unknown;
    };
    return (
      typeof maybeMock.mock === 'object' ||
      typeof maybeMock.mockClear === 'function' ||
      typeof maybeMock.mockReset === 'function' ||
      typeof maybeMock.mockRestore === 'function'
    );
  };

  const originalMock = viCompat.mock?.bind(viCompat);
  if (originalMock) {
    const resolveCallerFile = (): string | undefined => {
      const stack = new Error().stack;
      if (!stack) return undefined;
      const lines = stack.split('\n').slice(2);
      for (const line of lines) {
        const match = line.match(/\(([^)]+):\d+:\d+\)$/) ?? line.match(/at ([^ ]+):\d+:\d+$/);
        const raw = match?.[1];
        if (!raw) continue;
        if (raw.includes('tests/setup-bun.ts')) continue;
        if (raw.startsWith('file://')) {
          try {
            return fileURLToPath(raw);
          } catch {
            continue;
          }
        }
        if (path.isAbsolute(raw)) return raw;
      }
      return undefined;
    };

    const getMockTargets = (modulePath: string): string[] => {
      const targets = new Set<string>([modulePath]);
      const caller = resolveCallerFile();
      if (caller && modulePath.startsWith('.')) {
        const abs = path.resolve(path.dirname(caller), modulePath);
        targets.add(abs);
        targets.add(`file://${abs}`);
        if (abs.endsWith('.js')) {
          const ts = abs.replace(/\.js$/, '.ts');
          targets.add(ts);
          targets.add(`file://${ts}`);
        }
        if (abs.endsWith('.ts')) {
          const js = abs.replace(/\.ts$/, '.js');
          targets.add(js);
          targets.add(`file://${js}`);
        }
      }
      return Array.from(targets);
    };

    const applyMock = (modulePath: string, factoryImpl: () => unknown) => {
      const targets = getMockTargets(modulePath);
      for (const target of targets) {
        mock.module(target, factoryImpl as any);
      }
      if (!modulePath.startsWith('node:') && !modulePath.startsWith('.')) {
        for (const target of targets) {
          mock.module(`node:${target}`, factoryImpl as any);
        }
      }
    };

    viCompat.mock = (modulePath, factory) => {
      if (factory && factory.length > 0) {
        return applyMock(modulePath, () =>
          (factory as (importOriginal: () => Promise<unknown>) => unknown)(
            () => import(modulePath),
          ),
        );
      }
      if (factory) return applyMock(modulePath, factory);
      const autoMockFactory = () =>
        new Proxy({ __esModule: true } as Record<string, unknown>, {
          get(target, key) {
            if (!(key in target)) {
              target[key as string] = viCompat.fn!();
            }
            return target[key as string];
          },
        });
      return applyMock(modulePath, autoMockFactory);
    };
  }

  const envRestore = new Map<string, string | undefined>();
  viCompat.stubEnv ??= (key, value) => {
    if (!envRestore.has(key)) {
      envRestore.set(key, process.env[key]);
    }
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };
  viCompat.unstubAllEnvs ??= () => {
    for (const [key, value] of envRestore.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    envRestore.clear();
  };

  const globalRestore = new Map<string, unknown>();
  viCompat.stubGlobal ??= (key, value) => {
    if (!globalRestore.has(key)) {
      globalRestore.set(key, (globalThis as Record<string, unknown>)[key]);
    }
    (globalThis as Record<string, unknown>)[key] = value;
  };
  viCompat.unstubAllGlobals ??= () => {
    for (const [key, value] of globalRestore.entries()) {
      (globalThis as Record<string, unknown>)[key] = value;
    }
    globalRestore.clear();
  };

  viCompat.resetModules ??= () => {
    const maybeMock = (globalThis as { mock?: { restore?: () => void } }).mock;
    maybeMock?.restore?.();
  };

  const OriginalDate = Date;
  let fakeNowMs: number | undefined;
  const originalAdvanceTimersByTime = viCompat.advanceTimersByTime?.bind(viCompat);
  const originalRunAllTimers = viCompat.runAllTimers?.bind(viCompat);
  const originalUseRealTimers = viCompat.useRealTimers?.bind(viCompat);
  viCompat.setSystemTime ??= (when) => {
    fakeNowMs = new OriginalDate(when).getTime();
    class MockDate extends OriginalDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(fakeNowMs ?? OriginalDate.now());
        } else {
          super(args[0]);
        }
      }
      static now() {
        return fakeNowMs ?? OriginalDate.now();
      }
    }
    (globalThis as any).Date = MockDate;
  };
  if (originalAdvanceTimersByTime) {
    viCompat.advanceTimersByTime = ((ms: number) => {
      if (fakeNowMs !== undefined) {
        fakeNowMs += ms;
      }
      return originalAdvanceTimersByTime(ms);
    }) as typeof viCompat.advanceTimersByTime;
  }
  (viCompat as any).advanceTimersByTimeAsync ??= async (ms: number) => {
    if (!viCompat.advanceTimersByTime) {
      throw new Error('vi.advanceTimersByTime is not available');
    }

    // Advance in chunks so timers created by earlier callbacks can fire in the same async tick window.
    let remaining = Math.max(0, Math.floor(ms));
    while (remaining > 0) {
      const chunk = remaining >= 10_000 ? 250 : remaining >= 2_000 ? 50 : remaining >= 200 ? 10 : 1;
      const step = Math.min(remaining, chunk);
      viCompat.advanceTimersByTime(step);
      remaining -= step;
      await Promise.resolve();
    }

    if (viCompat.runOnlyPendingTimers && viCompat.getTimerCount) {
      for (let i = 0; i < 20; i++) {
        const before = viCompat.getTimerCount();
        if (!Number.isFinite(before) || before <= 0) break;
        viCompat.runOnlyPendingTimers();
        await Promise.resolve();
        const after = viCompat.getTimerCount();
        if (!Number.isFinite(after) || after <= 0 || after === before) break;
      }
    }
  };
  if (originalRunAllTimers) {
    (viCompat as any).runAllTimersAsync ??= async () => {
      originalRunAllTimers();
      await Promise.resolve();
    };
  }
  if (originalUseRealTimers) {
    viCompat.useRealTimers = ((...args: unknown[]) => {
      (globalThis as any).Date = OriginalDate;
      fakeNowMs = undefined;
      return (originalUseRealTimers as any)(...args);
    }) as typeof viCompat.useRealTimers;
  }
}

function ensureVitestModuleCompat() {
  mock.module('vitest', () => ({
    describe,
    it,
    test,
    expect,
    beforeEach,
    afterEach,
    beforeAll,
    afterAll,
    vi,
  }));

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

function ensureTestGlobals() {
  const globalRecord = globalThis as Record<string, unknown>;
  globalRecord.describe ??= describe;
  globalRecord.it ??= it;
  globalRecord.test ??= test;
  globalRecord.expect ??= expect;
  globalRecord.beforeEach ??= beforeEach;
  globalRecord.afterEach ??= afterEach;
  globalRecord.beforeAll ??= beforeAll;
  globalRecord.afterAll ??= afterAll;
}

ensureDom();
ensureVitestCompat();
ensureVitestModuleCompat();
ensureTestGlobals();

// Testing guidelines: keep test runs silent and self-validating.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

afterAll(() => {
  // CRITICAL SAFETY: Ensure no mocks leak between tests.
  vi.restoreAllMocks();
});
