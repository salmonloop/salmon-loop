import { useCallback, useEffect, useRef, useState } from 'react';

interface QueueEntry<T, R> {
  item: T;
  resolve: (value: R) => void;
  reject: (error: unknown) => void;
}

export interface MessageQueueControls<T, R> {
  enqueue: (item: T) => Promise<R>;
  clear: () => void;
  isProcessing: boolean;
  pendingCount: number;
}

export function useMessageQueue<T, R>(
  handler: (item: T) => Promise<R>,
): MessageQueueControls<T, R> {
  const queueRef = useRef<Array<QueueEntry<T, R>>>([]);
  const processingRef = useRef(false);
  const isMountedRef = useRef(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updatePendingCount = useCallback(() => {
    if (!isMountedRef.current) return;
    setPendingCount(queueRef.current.length);
  }, []);

  const processNext = useCallback(() => {
    if (!isMountedRef.current || processingRef.current) return;

    const next = queueRef.current.shift();
    if (!next) {
      updatePendingCount();
      return;
    }

    processingRef.current = true;
    if (isMountedRef.current) {
      setIsProcessing(true);
      updatePendingCount();
    }

    Promise.resolve(handler(next.item))
      .then((result) => {
        next.resolve(result);
      })
      .catch((error) => {
        next.reject(error);
      })
      .finally(() => {
        processingRef.current = false;
        if (isMountedRef.current) {
          setIsProcessing(false);
        }
        processNext();
      });
  }, [handler, updatePendingCount]);

  const enqueue = useCallback(
    (item: T) => {
      const promise = new Promise<R>((resolve, reject) => {
        queueRef.current.push({ item, resolve, reject });
        updatePendingCount();
        queueMicrotask(processNext);
      });
      promise.catch(() => {});
      return promise;
    },
    [processNext, updatePendingCount],
  );

  const clear = useCallback(() => {
    queueRef.current = [];
    updatePendingCount();
  }, [updatePendingCount]);

  return {
    enqueue,
    clear,
    isProcessing,
    pendingCount,
  };
}
