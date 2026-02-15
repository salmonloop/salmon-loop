import type { ExecutionPlan } from '../../grizzco/dsl/DecisionEngine.js';
import type { SlashDslContext } from '../strategy.js';
import type { SlashDispatchDecision, SlashHandlerRequest, SlashRouterOptions } from '../types.js';

import type { SlashInternalData } from './types.js';

function planToDecision(
  plan: ExecutionPlan,
  options: { unknownSlashPolicy: 'block' | 'forward_as_text' },
): SlashDispatchDecision {
  const action = plan.actions[0];
  if (!action) return { kind: 'consumed' };

  if (action.type === 'FORWARD_TEXT') {
    const next = String((action.params as any)?.input ?? '');
    return { kind: 'forward', input: next };
  }

  if (action.type === 'UNKNOWN_SLASH') {
    const cmd = String((action.params as any)?.commandName ?? '');
    if (options.unknownSlashPolicy === 'forward_as_text') {
      return { kind: 'forward', input: cmd };
    }
    return { kind: 'block', code: 'UNKNOWN_SLASH', details: { commandName: cmd } };
  }

  // EXECUTE_SLASH is handled in the macro layer.
  return { kind: 'consumed' };
}

export function buildSlashExecuteStep(options: SlashRouterOptions, meta?: unknown) {
  return async (context: SlashDslContext): Promise<SlashDslContext> => {
    const data = (context.data ?? {}) as SlashInternalData;
    const plan = data.__plan;
    if (!plan) {
      return { ...context, data: { ...data, __decision: { kind: 'consumed' } } };
    }

    const action = plan.actions[0];
    if (!action) {
      return { ...context, data: { ...data, __decision: { kind: 'consumed' } } };
    }

    if (action.type !== 'EXECUTE_SLASH') {
      const decision = planToDecision(plan, { unknownSlashPolicy: options.unknownSlashPolicy });
      return { ...context, data: { ...data, __decision: decision } };
    }

    const commandName = String((action.params as any)?.commandName ?? '');
    const spec = options.registry.find(commandName);
    if (!spec) {
      const decision = planToDecision(
        { ...plan, actions: [{ type: 'UNKNOWN_SLASH', params: { commandName } }] } as any,
        { unknownSlashPolicy: options.unknownSlashPolicy },
      );
      return { ...context, data: { ...data, __decision: decision } };
    }

    const handler = options.handlers.getHandler(spec.name);
    if (!handler) {
      return {
        ...context,
        data: {
          ...data,
          __decision: { kind: 'block', code: 'NO_HANDLER', details: { commandName: spec.name } },
        },
      };
    }

    const req: SlashHandlerRequest = {
      rawInput: context.input.raw,
      command: spec,
      argsText: String((action.params as any)?.argsText ?? ''),
      tokens: Array.isArray((action.params as any)?.tokens) ? (action.params as any).tokens : [],
      meta,
    };

    const result = await handler.execute(req);
    if (result.kind === 'rewrite') {
      return {
        ...context,
        data: { ...data, __decision: { kind: 'rewrite', input: result.input } },
      };
    }
    if (result.kind === 'forward') {
      return {
        ...context,
        data: { ...data, __decision: { kind: 'forward', input: result.input } },
      };
    }
    return { ...context, data: { ...data, __decision: { kind: 'consumed' } } };
  };
}
