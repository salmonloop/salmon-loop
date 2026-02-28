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
}
