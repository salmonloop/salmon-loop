import { describe, expect, it } from 'bun:test';

import { PlanBuilder, DecisionEngine } from '../../../../src/core/grizzco/dsl/DecisionEngine.js';
import { SlashStrategyDSL, type SlashDslContext } from '../../../../src/core/slash/strategy.js';

describe('SlashStrategyDSL', () => {
  it('aborts when no raw input is provided', () => {
    const builder = new PlanBuilder<SlashDslContext>();
    const ctx: SlashDslContext = { input: { raw: undefined as any, trimmed: '', isSlash: false } };
    const engine = new DecisionEngine(ctx, builder);

    SlashStrategyDSL(engine);

    const plan = builder.build();
    expect(plan.shouldAbort).toBe(true);
    expect(plan.abortReason).toBe('No input provided');
  });

  it('forwards non-slash input', () => {
    const builder = new PlanBuilder<SlashDslContext>();
    const ctx: SlashDslContext = {
      input: { raw: 'hello world', trimmed: 'hello world', isSlash: false },
    };
    const engine = new DecisionEngine(ctx, builder);

    SlashStrategyDSL(engine);

    const plan = builder.build();
    expect(plan.shouldAbort).toBe(false);
    expect(plan.workerId).toBe('slash.forward');
    expect(plan.actions).toEqual([{ type: 'FORWARD_TEXT', params: { input: 'hello world' } }]);
  });

  it('executes slash command when resolved', () => {
    const builder = new PlanBuilder<SlashDslContext>();
    const ctx: SlashDslContext = {
      input: {
        raw: '/test arg1',
        trimmed: '/test arg1',
        isSlash: true,
        commandName: '/test',
        argsText: 'arg1',
        tokens: ['arg1'],
      },
      resolved: {
        command: { name: '/test', description: 'Test command' },
      },
    };
    const engine = new DecisionEngine(ctx, builder);

    SlashStrategyDSL(engine);

    const plan = builder.build();
    expect(plan.shouldAbort).toBe(false);
    expect(plan.workerId).toBe('slash.execute');
    expect(plan.actions).toEqual([
      {
        type: 'EXECUTE_SLASH',
        params: { commandName: '/test', argsText: 'arg1', tokens: ['arg1'] },
      },
    ]);
  });

  it('handles unknown slash commands', () => {
    const builder = new PlanBuilder<SlashDslContext>();
    const ctx: SlashDslContext = {
      input: {
        raw: '/unknown',
        trimmed: '/unknown',
        isSlash: true,
        commandName: '/unknown',
      },
    };
    const engine = new DecisionEngine(ctx, builder);

    SlashStrategyDSL(engine);

    const plan = builder.build();
    expect(plan.shouldAbort).toBe(false);
    expect(plan.workerId).toBe('slash.unknown');
    expect(plan.actions).toEqual([{ type: 'UNKNOWN_SLASH', params: { commandName: '/unknown' } }]);
  });
});
