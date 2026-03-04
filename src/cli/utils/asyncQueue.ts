import { logIgnoredError } from '../../core/facades/cli-observability.js';

export interface AsyncQueueState {
  pendingCount: number;
  isProcessing: boolean;
  isPaused: boolean;
}

export interface AsyncQueueControls<T> {
  enqueue: (task: () => Promise<T>) => Promise<T>;
  enqueueFront: (task: () => Promise<T>) => Promise<T>;
  clear: () => number;
  pause: () => void;
  resume: () => void;
  getState: () => AsyncQueueState;
}

interface QueueEntry<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface AsyncQueueOptions {
  maxSize?: number;
  overflowStrategy?: 'reject' | 'drop_oldest' | 'drop_newest';
}

export function createAsyncQueue<T>(
  onStateChange?: (state: AsyncQueueState) => void,
  options: AsyncQueueOptions = {},
): AsyncQueueControls<T> {
  const queue: Array<QueueEntry<T>> = [];
  let isProcessing = false;
  let isPaused = false;
  const { maxSize, overflowStrategy = 'reject' } = options;

  const emitState = () => {
    onStateChange?.({ pendingCount: queue.length, isProcessing, isPaused });
  };

  const processNext = () => {
    if (isPaused) {
      emitState();
      return;
    }
    if (isProcessing) return;
    const next = queue.shift();
    if (!next) {
      emitState();
      return;
    }

    isProcessing = true;
    emitState();

    Promise.resolve(next.task())
      .then((result) => {
        next.resolve(result);
      })
      .catch((error) => {
        next.reject(error);
      })
      .finally(() => {
        isProcessing = false;
        emitState();
        processNext();
      });
  };

  const canAccept = () => {
    if (typeof maxSize !== 'number' || maxSize < 0) return true;
    if (queue.length < maxSize) return true;
    return false;
  };

  const enforceCapacity = (onDropNewest: () => void, onDropOldest: () => void) => {
    if (canAccept()) return true;
    if (overflowStrategy === 'drop_oldest') {
      onDropOldest();
      return true;
    }
    if (overflowStrategy === 'drop_newest') {
      onDropNewest();
      return false;
    }
    onDropNewest();
    return false;
  };

  const enqueue = (task: () => Promise<T>) => {
    const promise = new Promise<T>((resolve, reject) => {
      const dropEntry = (entry: QueueEntry<T> | undefined) => {
        if (!entry) return;
        entry.reject(new Error('AsyncQueue overflow: task dropped'));
      };
      const accepted = enforceCapacity(
        () => reject(new Error('AsyncQueue overflow: task dropped')),
        () => dropEntry(queue.shift()),
      );
      if (!accepted) return;

      queue.push({ task, resolve, reject });
      emitState();
      queueMicrotask(processNext);
    });
    promise.catch((error) => logIgnoredError('[AsyncQueue] task rejected (enqueue)', error));
    return promise;
  };

  const enqueueFront = (task: () => Promise<T>) => {
    const promise = new Promise<T>((resolve, reject) => {
      const dropEntry = (entry: QueueEntry<T> | undefined) => {
        if (!entry) return;
        entry.reject(new Error('AsyncQueue overflow: task dropped'));
      };
      const accepted = enforceCapacity(
        () => reject(new Error('AsyncQueue overflow: task dropped')),
        () => dropEntry(queue.pop()),
      );
      if (!accepted) return;

      queue.unshift({ task, resolve, reject });
      emitState();
      queueMicrotask(processNext);
    });
    promise.catch((error) => logIgnoredError('[AsyncQueue] task rejected (enqueueFront)', error));
    return promise;
  };

  const clear = () => {
    let cleared = 0;
    while (queue.length > 0) {
      const entry = queue.shift();
      if (entry) {
        entry.reject(new Error('AsyncQueue cleared'));
        cleared += 1;
      }
    }
    emitState();
    return cleared;
  };

  const pause = () => {
    isPaused = true;
    emitState();
  };

  const resume = () => {
    if (!isPaused) return;
    isPaused = false;
    emitState();
    queueMicrotask(processNext);
  };

  const getState = () => ({ pendingCount: queue.length, isProcessing, isPaused });

  return {
    enqueue,
    enqueueFront,
    clear,
    pause,
    resume,
    getState,
  };
}
