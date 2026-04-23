import type { Artifact, Message, Task, TaskStatus, TaskStatusUpdateEvent } from '@a2a-js/sdk';
import { type AgentExecutor, type ExecutionEventBus, type TaskStore } from '@a2a-js/sdk/server';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';

import type { TaskEvent, TaskEventBus } from '../../../interaction/events/bus.js';
import type { TaskEnvelope } from '../../../interaction/model/index.js';
import type { TaskArtifact } from '../../../interaction/model/types.js';
import {
  buildCanonicalExecutionRequest,
  buildInstructionFromParts,
} from '../../shared/execution-request.js';
import { parseA2ASkillFlowMode } from '../../shared/flow-mode-mapping.js';

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
      taskId?: string;
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
  const submittedPublished = new Set<string>();
  // Prevents duplicate terminal status events when publishTaskStatus is called multiple times
  const terminalPublished = new Set<string>();

  return {
    async execute(requestContext, executionEventBus) {
      const capability =
        parseA2ASkillFlowMode(deps.capabilityResolver?.(requestContext.userMessage)) ?? 'autopilot';
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
        const executionRequest = buildCanonicalExecutionRequest({
          capability,
          instruction: extractInstruction(requestContext.userMessage),
          // Pass SDK's taskId to facade to ensure consistency with eventBusManager
          taskId: requestContext.taskId,
        });
        const { task } = await deps.facade.createTask(executionRequest);
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

    // Build status from task state
    const currentState = mapState(envelope.state);

    // ALWAYS publish "submitted" first if not yet published
    if (!submittedPublished.has(taskId)) {
      submittedPublished.add(taskId);
      const submittedStatus: TaskStatus = {
        state: 'submitted',
        timestamp: envelope.createdAt ?? new Date().toISOString(),
        message: undefined,
      };
      const submittedUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: envelope.id,
        contextId: metadata.contextId,
        status: submittedStatus,
        final: false,
        metadata: { attempt: envelope.attempt },
      };
      eventBus.publish(submittedUpdate);

      // Save as 'running' state (not completed) to keep task cancelable during grace period.
      // SDK rejects cancellation if task is already in terminal state in the store.
      const submittedEnvelope = { ...envelope, state: 'running' as const };
      const snapshot = buildTaskSnapshot(submittedEnvelope, metadata);
      await store.save(snapshot);

      // If the current state is still "submitted", we're done
      if (currentState === 'submitted') {
        return false;
      }
      // Otherwise, continue to publish the actual current state
    }

    // If terminal status already published, don't publish again
    if (terminalPublished.has(taskId)) {
      return true;
    }

    // For "completed" state, apply grace period and check for cancellation.
    // This prevents race condition where "completed" is published before cancellation arrives.
    if (currentState === 'completed') {
      if (cancelledTaskIds.has(taskId)) {
        terminalPublished.add(taskId);
        const canceledEnvelope = { ...envelope, state: 'cancelled' as const };
        const snapshot = buildTaskSnapshot(canceledEnvelope, metadata);
        await store.save(snapshot);
        const status = {
          ...buildTaskStatus(envelope, metadata.contextId),
          state: 'canceled' as const,
        };
        const update: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: envelope.id,
          contextId: metadata.contextId,
          status,
          final: true,
          metadata: { attempt: envelope.attempt },
        };
        eventBus.publish(update);
        return true;
      }

      // Grace period allows cancellation to arrive before publishing "completed"
      await delay(COMPLETION_GRACE_PERIOD_MS);

      // Check both executor state and store state to detect cancellation.
      // SDK may cancel directly in store if eventBus is unavailable.
      const taskAfterGrace = await store.load(taskId);
      const wasCancelled =
        cancelledTaskIds.has(taskId) || taskAfterGrace?.status.state === 'canceled';

      if (wasCancelled) {
        terminalPublished.add(taskId);
        if (taskAfterGrace?.status.state !== 'canceled') {
          const canceledEnvelope = { ...envelope, state: 'cancelled' as const };
          const snapshot = buildTaskSnapshot(canceledEnvelope, metadata);
          await store.save(snapshot);
        }
        const status = {
          ...buildTaskStatus(envelope, metadata.contextId),
          state: 'canceled' as const,
        };
        const update: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: envelope.id,
          contextId: metadata.contextId,
          status,
          final: true,
          metadata: { attempt: envelope.attempt },
        };
        eventBus.publish(update);
        return true;
      }

      // No cancellation detected, safe to publish "completed"
      terminalPublished.add(taskId);
      const snapshot = buildTaskSnapshot(envelope, metadata);
      await store.save(snapshot);
      const status = buildTaskStatus(envelope, metadata.contextId);
      const update: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: envelope.id,
        contextId: metadata.contextId,
        status,
        final: true,
        metadata: { attempt: envelope.attempt },
      };
      eventBus.publish(update);
      return true;
    }

    // For all other states (working, failed, canceled, etc.), save and publish immediately
    const snapshot = buildTaskSnapshot(envelope, metadata);
    await store.save(snapshot);
    const status = buildTaskStatus(envelope, metadata.contextId);
    const isFinal = isTerminalState(status.state);
    if (isFinal) {
      terminalPublished.add(taskId);
    }
    const update: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: envelope.id,
      contextId: metadata.contextId,
      status,
      final: isFinal,
      metadata: { attempt: envelope.attempt },
    };
    eventBus.publish(update);
    return isFinal;
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
    submittedPublished.delete(taskId);
    terminalPublished.delete(taskId);
  }

  function extractInstruction(message: Message): string {
    const textParts = message.parts
      .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
      .map((part) => part.text);
    return buildInstructionFromParts(textParts, { fallbackInstruction: 'Run task' });
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
