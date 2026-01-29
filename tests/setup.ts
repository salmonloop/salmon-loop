import { afterAll, vi } from 'vitest';

// Testing guidelines: keep test runs silent and self-validating.
// Many production paths use the shared logger, which delegates to console.*.
// We stub console output in tests to avoid noisy stdout/stderr and make CI output stable.

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

afterAll(() => {
  vi.restoreAllMocks();
});
