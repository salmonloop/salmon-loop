import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Semaphore } from '../../src/core/concurrency.js';

describe('Concurrency and Locking Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should handle concurrent loop executions with locking', async () => {
    // Create a semaphore with max 1 concurrent operation (simulating the global semaphore in loop.ts)
    const semaphore = new Semaphore(1);
    
    // Track execution order to verify locking behavior
    const executionOrder: string[] = [];
    
    // Simulate two concurrent "loop" operations that take some time
    const mockLoopOperation = async (id: string, delayMs: number): Promise<{ success: boolean; id: string }> => {
      executionOrder.push(`${id}-start`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      executionOrder.push(`${id}-end`);
      return { success: true, id };
    };

    // Run two operations concurrently through the semaphore
    const promise1 = semaphore.run(() => mockLoopOperation('loop1', 500));
    const promise2 = semaphore.run(() => mockLoopOperation('loop2', 500));

    // Advance timers to complete all operations
    // First operation takes 500ms, second operation takes 500ms (they run sequentially due to semaphore)
    await vi.advanceTimersByTimeAsync(1000);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Both should succeed
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    
    // Verify that operations ran sequentially (not concurrently) due to semaphore with max=1
    // The second operation should only start after the first one ends
    expect(executionOrder).toEqual(['loop1-start', 'loop1-end', 'loop2-start', 'loop2-end']);
  });

  it('should allow concurrent operations up to the semaphore limit', async () => {
    // Create a semaphore with max 2 concurrent operations
    const semaphore = new Semaphore(2);
    
    const executionOrder: string[] = [];
    
    const mockLoopOperation = async (id: string, delayMs: number): Promise<{ success: boolean; id: string }> => {
      executionOrder.push(`${id}-start`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      executionOrder.push(`${id}-end`);
      return { success: true, id };
    };

    // Run three operations concurrently through the semaphore
    const promise1 = semaphore.run(() => mockLoopOperation('loop1', 500));
    const promise2 = semaphore.run(() => mockLoopOperation('loop2', 500));
    const promise3 = semaphore.run(() => mockLoopOperation('loop3', 500));

    // Advance timers to complete all operations
    await vi.advanceTimersByTimeAsync(1000);

    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // All should succeed
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result3.success).toBe(true);
    
    // Verify that first two operations started concurrently, and third waited
    // loop1 and loop2 should both start before either ends
    expect(executionOrder[0]).toBe('loop1-start');
    expect(executionOrder[1]).toBe('loop2-start');
    // loop3 should only start after one of the first two ends
    const loop3StartIndex = executionOrder.indexOf('loop3-start');
    const loop1EndIndex = executionOrder.indexOf('loop1-end');
    const loop2EndIndex = executionOrder.indexOf('loop2-end');
    expect(loop3StartIndex).toBeGreaterThan(Math.min(loop1EndIndex, loop2EndIndex));
  });

  it('should handle errors without blocking other operations', async () => {
    const semaphore = new Semaphore(1);
    
    const executionOrder: string[] = [];
    
    const failingOperation = async (): Promise<{ success: boolean }> => {
      executionOrder.push('failing-start');
      await new Promise(resolve => setTimeout(resolve, 100));
      executionOrder.push('failing-error');
      throw new Error('Simulated failure');
    };

    const successOperation = async (): Promise<{ success: boolean }> => {
      executionOrder.push('success-start');
      await new Promise(resolve => setTimeout(resolve, 100));
      executionOrder.push('success-end');
      return { success: true };
    };

    // Run failing operation first, then success operation
    const promise1 = semaphore.run(failingOperation).catch(e => ({ success: false, error: e.message }));
    const promise2 = semaphore.run(successOperation);

    // Advance timers
    await vi.advanceTimersByTimeAsync(300);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // First should fail, second should succeed
    expect(result1.success).toBe(false);
    expect(result2.success).toBe(true);
    
    // Verify that second operation still ran after the first failed
    expect(executionOrder).toEqual(['failing-start', 'failing-error', 'success-start', 'success-end']);
  });
});
