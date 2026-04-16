import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';
import { createInteractionFacade } from '../../../../src/core/interaction/orchestration/index.js';

describe('interaction facade', () => {
  test('creates tasks in accepted state before execution', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    expect(created.state).toBe('accepted');

    const loaded = await facade.getTask(created.id);
    expect(loaded?.id).toBe(created.id);
  });

  test('updates stored task after execution completes', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const loaded = await facade.getTask(created.id);
    expect(loaded?.state).toBe('completed');
  });

  test('cancels an existing task', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => task,
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    const cancelled = await facade.cancelTask(created.id);

    expect(cancelled?.state).toBe('cancelled');
  });

  test('publishes completed and cancelled lifecycle events on valid transitions', async () => {
    const bus = createTaskEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => {
      seen.push(event.type);
    });

    const completingFacade = createInteractionFacade({
      eventBus: bus,
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    await completingFacade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancellableFacade = createInteractionFacade({
      eventBus: bus,
      executeTask: async (task) => task,
    });
    const { task: created } = await cancellableFacade.createTask({
      capability: 'patch',
      request: { instruction: 'cancel me' },
    });
    await cancellableFacade.cancelTask(created.id);

    expect(seen).toEqual(['task.accepted', 'task.completed', 'task.accepted', 'task.cancelled']);
  });

  test('accepts input only for awaiting_input tasks and clears required action', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const awaiting = await facade.getTask(created.id);
    expect(awaiting).not.toBeNull();

    const resumed = await facade.submitInput(created.id, {
      type: 'confirmation',
      value: 'approve',
    });

    expect(resumed).toBeNull();

    const facadeWithAwaitingTask = createInteractionFacade({
      executeTask: async (task) => ({
        ...task,
        state: 'awaiting_input',
        inputRequired: { type: 'confirmation', prompt: 'Approve patch?' },
      }),
    });

    const { task: awaitingCreated } = await facadeWithAwaitingTask.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const resumedAwaiting = await facadeWithAwaitingTask.submitInput(awaitingCreated.id, {
      type: 'confirmation',
      value: 'approve',
    });

    expect(resumedAwaiting).toMatchObject({
      state: 'running',
      statusMessage: 'Input received: approve',
      inputRequired: undefined,
    });

    const mismatchInput = await facadeWithAwaitingTask.submitInput(awaitingCreated.id, {
      type: 'other',
      value: 'stuff',
    });
    expect(mismatchInput).toBeNull();

    const noTaskInput = await facadeWithAwaitingTask.submitInput('invalid', {
      type: 'confirmation',
      value: 'approve',
    });
    expect(noTaskInput).toBeNull();
  });

  test('resumes suspended tasks only from resumable states', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({
        ...task,
        state: 'streaming',
        statusMessage: 'Streaming in progress',
      }),
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const resumedStreaming = await facade.resumeTask(created.id);
    expect(resumedStreaming).toMatchObject({
      state: 'running',
      statusMessage: 'Task resumed',
    });

    const terminalFacade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    const { task: terminalCreated } = await terminalFacade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const resumedTerminal = await terminalFacade.resumeTask(terminalCreated.id);
    expect(resumedTerminal).toBeNull();
  });

  test('denies retry or reopen when failure metadata disallows it', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({
        ...task,
        state: 'failed',
        failure: {
          code: 'POLICY_BLOCK',
          category: 'policy',
          message: 'Policy denied',
          retryable: true,
        },
      }),
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const retried = await facade.retryTask(created.id);
    expect(retried).toBeNull();

    const reopened = await facade.reopenTask(created.id, {
      type: 'confirmation',
      reason: 'reopen',
      prompt: 'Try again?',
    });
    expect(reopened).toBeNull();
  });

  test('fails, retries, and reopens tasks through canonical transitions', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'running' }),
    });

    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const failed = await facade.failTask(created.id, {
      code: 'VERIFY_FAILED',
      category: 'verification',
      message: 'Verification failed',
      retryable: true,
    });
    expect(failed).toMatchObject({
      state: 'failed',
      failure: {
        code: 'VERIFY_FAILED',
        category: 'verification',
        message: 'Verification failed',
        retryable: true,
      },
      attempt: 1,
    });

    const retried = await facade.retryTask(created.id);
    expect(retried).toMatchObject({
      state: 'accepted',
      failure: undefined,
      attempt: 2,
      statusMessage: 'Task retried',
    });

    const completedFacade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    const { task: completed } = await completedFacade.createTask({
      capability: 'patch',
      request: { instruction: 'ship it' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reopened = await completedFacade.reopenTask(completed.id, {
      type: 'confirmation',
      reason: 'reopen',
      prompt: 'Provide updated approval',
    });
    expect(reopened).toMatchObject({
      state: 'awaiting_input',
      inputRequired: {
        type: 'confirmation',
        reason: 'reopen',
        prompt: 'Provide updated approval',
      },
      statusMessage: 'Task reopened',
    });
  });

  test('publishes awaiting_input event when task completes in awaiting_input state', async () => {
    const bus = createTaskEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => {
      seen.push(event.type);
    });

    const awaitingInputFacade = createInteractionFacade({
      eventBus: bus,
      executeTask: async (task) => ({
        ...task,
        state: 'awaiting_input',
        inputRequired: { type: 'confirmation', prompt: 'Approve patch?' },
      }),
    });

    await awaitingInputFacade.createTask({
      capability: 'patch',
      request: { instruction: 'needs input' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toContain('task.awaiting_input');
  });

  test('lists tasks and filters correctly', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'running' }),
    });
    await facade.createTask({
      capability: 'patch',
      request: { instruction: 'one' },
    });
    const result = await facade.listTasks();
    expect(result.items.length).toBe(1);
    expect(result.items[0].capability).toBe('patch');
  });

  test('gets specific artifact for a task', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({
        ...task,
        state: 'completed',
        artifacts: [{ id: 'art1', name: 'output.txt', type: 'text', content: 'hello' }],
      }),
    });
    const { task: created } = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'has artifact' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const found = await facade.getArtifact(created.id, 'art1');
    expect(found?.artifacts?.[0].id).toBe('art1');
    const notFound = await facade.getArtifact(created.id, 'missing');
    expect(notFound).toBeNull();
    const noTask = await facade.getArtifact('invalid', 'art1');
    expect(noTask).toBeNull();
  });
});
