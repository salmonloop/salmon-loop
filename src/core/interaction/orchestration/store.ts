import type { TaskEnvelope } from '../model/index.js';

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, TaskEnvelope>();

  save(task: TaskEnvelope): void {
    this.tasks.set(task.id, task);
  }

  get(id: string): TaskEnvelope | null {
    return this.tasks.get(id) ?? null;
  }

  update(task: TaskEnvelope): TaskEnvelope {
    this.tasks.set(task.id, task);
    return task;
  }

  list(query?: { capability?: string; state?: string; limit?: number; cursor?: string }): {
    items: TaskEnvelope[];
    nextCursor?: string;
  } {
    let tasks = [...this.tasks.values()];

    if (query?.cursor) {
      const cursorIndex = tasks.findIndex((task) => task.id === query.cursor);
      tasks = cursorIndex >= 0 ? tasks.slice(cursorIndex + 1) : tasks;
    }

    if (query?.capability) {
      tasks = tasks.filter((task) => task.capability === query.capability);
    }

    if (query?.state) {
      tasks = tasks.filter((task) => task.state === query.state);
    }

    const items = typeof query?.limit === 'number' ? tasks.slice(0, query.limit) : tasks;
    const nextCursor =
      typeof query?.limit === 'number' && tasks.length > items.length && items.length > 0
        ? items[items.length - 1]?.id
        : undefined;

    return { items, nextCursor };
  }
}
