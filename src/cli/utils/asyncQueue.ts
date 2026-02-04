export interface AsyncQueueState {
  pendingCount: number;
  isProcessing: boolean;
}

export interface AsyncQueueControls<T> {
  enqueue: (task: () => Promise<T>) => Promise<T>;
  clear: () => void;
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
  const { maxSize, overflowStrategy = 'reject' } = options;

  const emitState = () => {
    onStateChange?.({ pendingCount: queue.length, isProcessing });
  };

  const processNext = () => {
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

  const enqueue = (task: () => Promise<T>) => {
    const promise = new Promise<T>((resolve, reject) => {
      if (typeof maxSize === 'number' && maxSize >= 0 && queue.length >= maxSize) {
        if (overflowStrategy === 'drop_oldest') {
          queue.shift();
        } else if (overflowStrategy === 'drop_newest') {
          reject(new Error('AsyncQueue overflow: task dropped'));
          return;
        } else {
          reject(new Error('AsyncQueue overflow: queue is full'));
          return;
        }
      }

      queue.push({ task, resolve, reject });
      emitState();
      queueMicrotask(processNext);
    });
    promise.catch(() => {});
    return promise;
  };

  const clear = () => {
    queue.length = 0;
    emitState();
  };

  const getState = () => ({ pendingCount: queue.length, isProcessing });

  return {
    enqueue,
    clear,
    getState,
  };
}
