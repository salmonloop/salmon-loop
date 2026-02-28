export interface TaskEvent {
  id?: string;
  type: string;
  taskId: string;
  state?: string;
  attempt?: number;
  failure?: { category?: string; code?: string };
  requiredAction?: { type: string; reason?: string };
}

export interface TaskEventBus {
  subscribe(listener: (event: TaskEvent) => void): () => void;
  publish(event: TaskEvent): void;
  list(taskId: string, options?: { afterId?: string | null; limit?: number }): TaskEvent[];
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
      let resolvedId = event.id;
      if (resolvedId) {
        const numericId = Number(resolvedId);
        if (Number.isFinite(numericId) && numericId >= nextId) {
          nextId = numericId + 1;
        } else {
          resolvedId = String(nextId++);
        }
      } else {
        resolvedId = String(nextId++);
      }

      const persistedEvent = {
        ...event,
        id: resolvedId,
      };
      events.push(persistedEvent);
      for (const listener of listeners) {
        listener(persistedEvent);
      }
    },
    list(taskId, options) {
      const afterId = options?.afterId ?? null;
      const filtered = events.filter((event) => {
        if (event.taskId !== taskId) return false;
        if (!afterId) return true;
        return Number(event.id) > Number(afterId);
      });
      const limit = options?.limit;
      if (typeof limit === 'number') {
        return filtered.slice(0, Math.max(0, limit));
      }
      return filtered;
    },
  };
}
