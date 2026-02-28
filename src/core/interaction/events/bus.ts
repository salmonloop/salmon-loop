export interface TaskEvent {
  type: string;
  taskId: string;
}

export interface TaskEventBus {
  subscribe(listener: (event: TaskEvent) => void): () => void;
  publish(event: TaskEvent): void;
}

export function createTaskEventBus(): TaskEventBus {
  const listeners = new Set<(event: TaskEvent) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
