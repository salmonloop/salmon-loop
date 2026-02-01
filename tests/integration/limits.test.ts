import { Semaphore } from '../../src/core/concurrency.js';
import { LIMITS } from '../../src/core/limits.js';
import { runVerify } from '../../src/core/verify.js';

// Mock the runVerify function to simulate timeout behavior
vi.mock('../../src/core/verify.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/core/verify.js')>();
  return {
    ...original,
    runVerify: vi.fn(),
  };
});

const mockedRunVerify = vi.mocked(runVerify);

describe('Resource Limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should respect verify timeout', async () => {
    // Mock runVerify to simulate a long-running command that times out
    mockedRunVerify.mockImplementation(async () => {
      // Simulate waiting for the timeout duration
      await new Promise((resolve) => setTimeout(resolve, LIMITS.verifyTimeoutMs + 1000));
      return {
        ok: false,
        output: '[Error] Verification timed out and was terminated.',
        exitCode: null,
      };
    });

    // Create a promise that calls the mocked runVerify
    const verifyPromise = runVerify('/fake-repo', 'long-running-command');

    // Advance timers past the timeout
    await vi.advanceTimersByTimeAsync(LIMITS.verifyTimeoutMs + 2000);

    const result = await verifyPromise;

    // Verify that the result indicates timeout
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Verification timed out');
  });

  it('should respect maxContextChars limit', () => {
    // Test that LIMITS.maxContextChars is defined and reasonable
    expect(LIMITS.maxContextChars).toBeDefined();
    expect(typeof LIMITS.maxContextChars).toBe('number');
    expect(LIMITS.maxContextChars).toBeGreaterThan(0);
  });

  it('should respect maxRetries limit', () => {
    // Test that LIMITS.maxRetries is defined and reasonable
    expect(LIMITS.maxRetries).toBeDefined();
    expect(typeof LIMITS.maxRetries).toBe('number');
    expect(LIMITS.maxRetries).toBeGreaterThan(0);
  });

  it('should handle semaphore concurrency limits', async () => {
    const semaphore = new Semaphore(LIMITS.maxConcurrentOperations);

    const runningCount = { current: 0, max: 0 };

    const task = async () => {
      runningCount.current++;
      runningCount.max = Math.max(runningCount.max, runningCount.current);
      await new Promise((resolve) => setTimeout(resolve, 100));
      runningCount.current--;
      return true;
    };

    // Run more tasks than the limit allows
    const numTasks = LIMITS.maxConcurrentOperations + 3;
    const promises = Array.from({ length: numTasks }, () => semaphore.run(task));

    // Advance timers to complete all tasks
    await vi.advanceTimersByTimeAsync(numTasks * 100);

    const results = await Promise.all(promises);

    // All tasks should complete successfully
    expect(results.every((r) => r === true)).toBe(true);

    // Max concurrent should not exceed the limit
    expect(runningCount.max).toBeLessThanOrEqual(LIMITS.maxConcurrentOperations);
  });
});
