import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';
import { createInteractionFacade } from '../../../../src/core/interaction/orchestration/index.js';

describe('interaction facade', () => {
  test('creates tasks in accepted state before execution', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const created = await facade.createTask({
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

    const created = await facade.createTask({
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

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    const cancelled = await facade.cancelTask(created.id);

    expect(cancelled?.state).toBe('cancelled');
  });

  test('publishes accepted, completed, and cancelled events to the task bus', async () => {
    const bus = createTaskEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => {
      seen.push(event.type);
    });

    const facade = createInteractionFacade({
      eventBus: bus,
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await facade.cancelTask(created.id);

    expect(seen).toEqual(['task.accepted', 'task.completed', 'task.cancelled']);
  });

  test('accepts input only for awaiting_input tasks and clears required action', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const created = await facade.createTask({
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

    const awaitingCreated = await facadeWithAwaitingTask.createTask({
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
  });

  test('resumes suspended tasks only from resumable states', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({
        ...task,
        state: 'streaming',
        statusMessage: 'Streaming in progress',
      }),
    });

    const created = await facade.createTask({
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
    const terminalCreated = await terminalFacade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const resumedTerminal = await terminalFacade.resumeTask(terminalCreated.id);
    expect(resumedTerminal).toBeNull();
  });
});
