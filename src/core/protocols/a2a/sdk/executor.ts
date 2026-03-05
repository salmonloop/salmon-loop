import type { Artifact, Message, Task, TaskStatus, TaskStatusUpdateEvent } from '@a2a-js/sdk';
import { type AgentExecutor, type ExecutionEventBus, type TaskStore } from '@a2a-js/sdk/server';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';

import type { TaskEvent, TaskEventBus } from '../../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../../interaction/model/index.js';
import type { TaskArtifact } from '../../../interaction/model/types.js';

type TaskMetadata = {
  contextId: string;
  message: Message;
  capability: string;
};

export type CreateA2AInteractionExecutorDeps = {
  facade: {
    createTask(input: {
      capability: string;
      request: { instruction: string };
    }): Promise<{ task: TaskEnvelope }>;
    getTask(id: string): Promise<TaskEnvelope | null>;
    cancelTask(id: string): Promise<TaskEnvelope | null>;
  };
  taskEventBus: TaskEventBus;
  taskStore?: TaskStore;
  capabilityResolver?: (message: Message) => string;
};

export function createA2AInteractionExecutor(
  deps: CreateA2AInteractionExecutorDeps,
): AgentExecutor {
  const store = deps.taskStore ?? new InMemoryTaskStore();
  const metadataByTaskId = new Map<string, TaskMetadata>();
  const cancelledTaskIds = new Set<string>();
  const COMPLETION_GRACE_PERIOD_MS = 1500;
  const cleanupByTaskId = new Map<string, () => void>();
  const cancellationWaiters = new Map<string, (() => void)[]>();

  return {
    async execute(requestContext, executionEventBus) {
      const capability = deps.capabilityResolver?.(requestContext.userMessage) ?? 'patch';
      const pendingEvents: TaskEvent[] = [];
      let resolvedTaskId: string | null = null;
      let cleanedUp = false;

      const unsubscribe = deps.taskEventBus.subscribe((event) => {
        if (!resolvedTaskId) {
          pendingEvents.push(event);
          return;
        }
        if (event.taskId === resolvedTaskId) {
          void handleTaskEvent(event);
        }
      });

      const cleanup = () => {
        if (!cleanedUp) {
          unsubscribe();
          cleanedUp = true;
          if (resolvedTaskId) {
            cleanupByTaskId.delete(resolvedTaskId);
          }
        }
      };

      const handleTaskEvent = async (_event: TaskEvent) => {
        if (!resolvedTaskId) return;
        const isFinal = await publishTaskStatus(resolvedTaskId, executionEventBus);
        if (isFinal) {
          finalizeTask(resolvedTaskId, executionEventBus);
        }
      };

      try {
        const { task } = await deps.facade.createTask({
          capability,
          request: { instruction: extractInstruction(requestContext.userMessage) },
        });
        resolvedTaskId = task.id;
        cleanupByTaskId.set(task.id, cleanup);
        metadataByTaskId.set(task.id, {
          contextId: requestContext.userMessage.contextId ?? requestContext.contextId,
          message: requestContext.userMessage,
          capability,
        });

        for (const event of pendingEvents) {
          if (event.taskId === resolvedTaskId) {
            await handleTaskEvent(event);
          }
        }
      } catch (error) {
        cleanup();
        throw error;
      }
    },
    async cancelTask(taskId, cancelEventBus) {
      cancelledTaskIds.add(taskId);
      signalCancellation(taskId);
      await deps.facade.cancelTask(taskId);
      const isFinal = await publishTaskStatus(taskId, cancelEventBus);
      if (isFinal) {
        finalizeTask(taskId, cancelEventBus);
      }
    },
  };

  async function publishTaskStatus(taskId: string, eventBus: ExecutionEventBus): Promise<boolean> {
    const metadata = metadataByTaskId.get(taskId);
    if (!metadata) return false;
    const envelope = await deps.facade.getTask(taskId);
    if (!envelope) return false;

    const snapshot = buildTaskSnapshot(envelope, metadata);
    await store.save(snapshot);

    let status = buildTaskStatus(envelope, metadata.contextId);
    let shouldOverrideCancel = cancelledTaskIds.has(taskId);
    if (status.state === 'completed' && !shouldOverrideCancel) {
      await delay(COMPLETION_GRACE_PERIOD_MS);
      shouldOverrideCancel = cancelledTaskIds.has(taskId);
    }
    if (shouldOverrideCancel && status.state !== 'canceled') {
      status = { ...status, state: 'canceled' };
    }
    const update: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: envelope.id,
      contextId: metadata.contextId,
      status,
      final: isTerminalState(status.state),
      metadata: { attempt: envelope.attempt },
    };
    eventBus.publish(update);
    return update.final;
  }

  function finalizeTask(taskId: string, eventBus: ExecutionEventBus) {
    eventBus.finished();
    metadataByTaskId.delete(taskId);
    const cleanup = cleanupByTaskId.get(taskId);
    if (cleanup) {
      cleanup();
    }
    cleanupByTaskId.delete(taskId);
    cancelledTaskIds.delete(taskId);
  }

  function extractInstruction(message: Message): string {
    const textParts = message.parts
      .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
      .map((part) => part.text.trim())
      .filter(Boolean);
    return textParts.join('\n') || 'Run task';
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function signalCancellation(taskId: string) {
    const waiters = cancellationWaiters.get(taskId);
    if (!waiters) return;
    cancellationWaiters.delete(taskId);
    for (const resolve of waiters) {
      resolve();
    }
  }

  function waitForCancellation(taskId: string, timeout: number): Promise<boolean> {
    if (cancelledTaskIds.has(taskId)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const cleanup = () => {
        const waiters = cancellationWaiters.get(taskId);
        if (waiters) {
          cancellationWaiters.set(
            taskId,
            waiters.filter((waiter) => waiter !== listener),
          );
          if (cancellationWaiters.get(taskId)?.length === 0) {
            cancellationWaiters.delete(taskId);
          }
        }
      };
      const listener = () => {
        clearTimeout(timer);
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout);
      const waiters = cancellationWaiters.get(taskId) ?? [];
      waiters.push(listener);
      cancellationWaiters.set(taskId, waiters);
    });
  }

  function mapState(state: TaskEnvelope['state']): TaskStatus['state'] {
    switch (state) {
      case 'accepted':
        return 'submitted';
      case 'running':
      case 'streaming':
        return 'working';
      case 'awaiting_input':
        return 'input-required';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'canceled';
      default:
        return 'unknown';
    }
  }

  function isTerminalState(state: TaskStatus['state']): boolean {
    return (
      state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected'
    );
  }

  function buildTaskStatus(envelope: TaskEnvelope, contextId: string): TaskStatus {
    return {
      state: mapState(envelope.state),
      timestamp: envelope.createdAt ?? new Date().toISOString(),
      message: buildStatusMessage(envelope, contextId),
    };
  }

  function buildStatusMessage(envelope: TaskEnvelope, contextId: string): Message | undefined {
    const text =
      envelope.statusMessage ?? envelope.failure?.message ?? envelope.inputRequired?.prompt;
    if (!text) return undefined;
    return {
      kind: 'message',
      messageId: `status-${envelope.id}-${Date.now()}`,
      role: 'agent',
      contextId,
      parts: [
        {
          kind: 'text',
          text,
        },
      ],
    };
  }

  function buildTaskSnapshot(envelope: TaskEnvelope, metadata: TaskMetadata): Task {
    return {
      id: envelope.id,
      kind: 'task',
      contextId: metadata.contextId,
      history: [metadata.message],
      metadata: {
        capability: envelope.capability,
        attempt: envelope.attempt,
      },
      artifacts: convertArtifacts(envelope.artifacts),
      status: buildTaskStatus(envelope, metadata.contextId),
    };
  }

  function convertArtifacts(artifacts?: TaskArtifact[]): Artifact[] | undefined {
    if (!artifacts || artifacts.length === 0) return undefined;
    return artifacts.map((artifact) => ({
      artifactId: artifact.id,
      name: artifact.name,
      parts: [
        {
          kind: 'text',
          text: artifact.content ?? artifact.name ?? '',
        },
      ],
    }));
  }
}
