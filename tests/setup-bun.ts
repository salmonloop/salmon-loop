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

function ensureDom() {
  const globalRecord = globalThis as Record<string, unknown>;
  if (typeof globalRecord.document !== 'undefined') return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalRecord.window = dom.window;
  globalRecord.document = dom.window.document;
  globalRecord.navigator = dom.window.navigator;
  globalRecord.HTMLElement = dom.window.HTMLElement;
  globalRecord.Node = dom.window.Node;
  globalRecord.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
}

function ensureUiModuleStubs() {
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
  globalRecord.vi ??= vi;
  globalRecord.mock ??= mock;
}

ensureDom();
ensureUiModuleStubs();
ensureTestGlobals();

// Testing guidelines: keep test runs silent and self-validating.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

afterAll(() => {
  mock.restore();
  // CRITICAL SAFETY: Ensure no mocks leak between tests.
  vi.restoreAllMocks();
});
