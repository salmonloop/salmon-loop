import { createAsyncQueue } from '../../../../src/cli/utils/asyncQueue.js';

describe('createAsyncQueue', () => {
  it('runs tasks sequentially', async () => {
    const order: string[] = [];
    let resolveFirst: ((value: string) => void) | undefined;
    let resolveSecond: ((value: string) => void) | undefined;

    const queue = createAsyncQueue<string>();

    const first = queue.enqueue(
      () =>
        new Promise((resolve) => {
          order.push('first');
          resolveFirst = resolve;
        }),
    );
    const second = queue.enqueue(
      () =>
        new Promise((resolve) => {
          order.push('second');
          resolveSecond = resolve;
        }),
    );

    await Promise.resolve();
    expect(order).toEqual(['first']);

    resolveFirst?.('done-1');
    await first;
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(order).toEqual(['first', 'second']);

    resolveSecond?.('done-2');
    await second;
  });

  it('continues after a rejected task', async () => {
    const queue = createAsyncQueue<string>();
    const error = new Error('boom');

    const first = queue.enqueue(() => Promise.reject(error));
    const second = queue.enqueue(() => Promise.resolve('ok'));

    let firstError: unknown;
    await first.catch((err) => {
      firstError = err;
    });

    const secondResult = await second;

    expect(firstError).toBe(error);
    expect(secondResult).toBe('ok');
  });

  it('emits state changes', async () => {
    const states: Array<{ pendingCount: number; isProcessing: boolean; isPaused: boolean }> = [];
    const queue = createAsyncQueue<string>((state) => {
      states.push(state);
    });

    const task = queue.enqueue(() => Promise.resolve('ok'));
    await task;
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(states.length).toBeGreaterThan(0);
    expect(states[states.length - 1]).toEqual({
      pendingCount: 0,
      isProcessing: false,
      isPaused: false,
    });
  });

  it('rejects when the queue is full by default', async () => {
    const queue = createAsyncQueue<string>(undefined, { maxSize: 0 });
    let error: unknown;

    await queue
      .enqueue(() => Promise.resolve('ok'))
      .catch((err) => {
        error = err;
      });

    expect(error).toBeInstanceOf(Error);
  });

  it('pauses processing until resumed', async () => {
    const queue = createAsyncQueue<string>();
    const order: string[] = [];
    let resolveFirst: ((value: string) => void) | undefined;

    queue.pause();

    const first = queue.enqueue(
      () =>
        new Promise((resolve) => {
          order.push('first');
          resolveFirst = resolve;
        }),
    );

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(order).toEqual([]);

    queue.resume();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(order).toEqual(['first']);

    resolveFirst?.('done');
    await first;
  });

  it('supports enqueueFront', async () => {
    const queue = createAsyncQueue<string>();
    const order: string[] = [];
    let resolveFirst: ((value: string) => void) | undefined;
    let resolveSecond: ((value: string) => void) | undefined;

    const first = queue.enqueue(
      () =>
        new Promise((resolve) => {
          order.push('first');
          resolveFirst = resolve;
        }),
    );
    const second = queue.enqueueFront(
      () =>
        new Promise((resolve) => {
          order.push('second');
          resolveSecond = resolve;
        }),
    );

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(order).toEqual(['second']);

    resolveSecond?.('done-2');
    await second;
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(order).toEqual(['second', 'first']);
    resolveFirst?.('done-1');
    await first;
  });

  it('rejects dropped tasks when using drop_oldest', async () => {
    const queue = createAsyncQueue<string>(undefined, {
      maxSize: 1,
      overflowStrategy: 'drop_oldest',
    });
    queue.pause();

    let resolveSecond: ((value: string) => void) | undefined;
    let firstError: unknown;

    const first = queue.enqueue(() => Promise.resolve('first'));
    const second = queue.enqueue(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    await first.catch((err) => {
      firstError = err;
    });

    queue.resume();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    resolveSecond?.('second');

    const secondResult = await second;

    expect(firstError).toBeInstanceOf(Error);
    expect(secondResult).toBe('second');
  });

  it('rejects pending tasks when cleared', async () => {
    const queue = createAsyncQueue<string>();
    queue.pause();

    let error: unknown;
    const task = queue.enqueue(() => Promise.resolve('ok'));

    const cleared = queue.clear();

    await task.catch((err) => {
      error = err;
    });

    expect(error).toBeInstanceOf(Error);
    expect(cleared).toBe(1);
  });
});
