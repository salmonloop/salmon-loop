export interface TaskEvent {
  id?: string;
  type: string;
  taskId: string;
}

export interface TaskEventBus {
  subscribe(listener: (event: TaskEvent) => void): () => void;
  publish(event: TaskEvent): void;
  list(taskId: string, options?: { afterId?: string | null }): TaskEvent[];
}

export function createTaskEventBus(): TaskEventBus {
  const listeners = new Set<(event: TaskEvent) => void>();
  const events: TaskEvent[] = [];
  let nextId = 1;

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      const persistedEvent = {
        ...event,
        id: event.id ?? String(nextId++),
      };
      events.push(persistedEvent);
      for (const listener of listeners) {
        listener(persistedEvent);
      }
    },
    list(taskId, options) {
      const afterId = options?.afterId ?? null;
      return events.filter((event) => {
        if (event.taskId !== taskId) return false;
        if (!afterId) return true;
        return Number(event.id) > Number(afterId);
      });
    },
  };
}
