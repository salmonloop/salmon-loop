import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';

import { useMessageQueue } from '../../../../../src/cli/ui/hooks/useMessageQueue.js';

describe('useMessageQueue', () => {
  it('processes items sequentially', async () => {
    const calls: string[] = [];
    let resolveFirst: ((value: string) => void) | undefined;
    let resolveSecond: ((value: string) => void) | undefined;

    const handler = vi.fn((item: string) => {
      calls.push(item);
      return new Promise<string>((resolve) => {
        if (item === 'first') {
          resolveFirst = resolve;
        } else {
          resolveSecond = resolve;
        }
      });
    });

    const { result } = renderHook(() => useMessageQueue<string, string>(handler));

    let firstPromise!: Promise<string>;
    let secondPromise!: Promise<string>;

    act(() => {
      firstPromise = result.current.enqueue('first');
      secondPromise = result.current.enqueue('second');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['first']);

    act(() => {
      resolveFirst?.('done-1');
    });

    await act(async () => {
      await firstPromise;
      await Promise.resolve();
    });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['first', 'second']);

    act(() => {
      resolveSecond?.('done-2');
    });

    await act(async () => {
      await secondPromise;
    });
  });

  it('continues after a handler rejection', async () => {
    const handler = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockImplementationOnce(() => Promise.resolve('ok'));

    const { result } = renderHook(() => useMessageQueue<string, string>(handler));

    let firstPromise!: Promise<string>;
    let secondPromise!: Promise<string>;

    await act(async () => {
      firstPromise = result.current.enqueue('first');
      secondPromise = result.current.enqueue('second');
    });

    let firstError: unknown;
    let secondResult: string | undefined;

    const firstHandled = firstPromise.catch((error) => {
      firstError = error;
      return 'handled';
    });

    const secondHandled = secondPromise.then((value) => {
      secondResult = value;
      return value;
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await firstHandled.catch(() => {});
      await secondHandled;
    });

    expect(firstError).toBeInstanceOf(Error);
    expect(secondResult).toBe('ok');
  });

  it('clears pending items', async () => {
    const handler = vi.fn(() => Promise.resolve('ok'));
    const { result } = renderHook(() => useMessageQueue<string, string>(handler));

    act(() => {
      result.current.enqueue('first');
      result.current.enqueue('second');
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.pendingCount).toBe(0);
  });
});
