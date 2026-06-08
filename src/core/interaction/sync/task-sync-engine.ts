import type { TaskEvent } from '../events/bus.js';
import type { TaskEnvelope } from '../model/index.js';

export function createTaskSyncEngine() {
  const tasks = new Map<string, TaskEnvelope>();

  type FailureCategory = 'verification' | 'runtime' | 'policy' | 'infrastructure';
  const allowedFailureCategories = new Set<FailureCategory>([
    'verification',
    'runtime',
    'policy',
    'infrastructure',
  ]);

  function coerceFailureCategory(value: unknown): FailureCategory | undefined {
    if (typeof value === 'string' && allowedFailureCategories.has(value as FailureCategory)) {
      return value as FailureCategory;
    }
    return undefined;
  }

  function applySnapshot(task: TaskEnvelope): TaskEnvelope {
    tasks.set(task.id, task);
    return task;
  }

  function applyEvent(event: TaskEvent): TaskEnvelope {
    const existing = tasks.get(event.taskId);
    const base: TaskEnvelope =
      existing ??
      ({
        id: event.taskId,
        capability: 'patch',
        state: 'accepted',
        request: { instruction: '' },
        createdAt: new Date().toISOString(),
      } satisfies TaskEnvelope);

    const updated: TaskEnvelope = {
      ...base,
      state: (event.state ?? base.state) as TaskEnvelope['state'],
      attempt: event.attempt ?? base.attempt,
      failure: event.failure
        ? {
            code: event.failure.code ?? base.failure?.code ?? 'UNKNOWN',
            category: coerceFailureCategory(event.failure.category) ?? base.failure?.category,
            message: base.failure?.message ?? '',
            retryable: base.failure?.retryable,
          }
        : base.failure,
      inputRequired: event.requiredAction
        ? {
            type: event.requiredAction.type,
            reason: event.requiredAction.reason as TaskEnvelope['inputRequired'] extends infer R
              ? R extends { reason?: infer RR }
                ? RR
                : undefined
              : undefined,
            prompt: base.inputRequired?.prompt ?? '',
          }
        : base.inputRequired,
    };

    tasks.set(updated.id, updated);
    return updated;
  }

  function get(taskId: string): TaskEnvelope | null {
    return tasks.get(taskId) ?? null;
  }

  return { applySnapshot, applyEvent, get };
}
