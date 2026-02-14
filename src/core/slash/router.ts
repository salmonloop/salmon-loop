import type { ExecutionPlan } from '../grizzco/dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../grizzco/dsl/MicroTaskRunner.js';
import { Pipeline } from '../grizzco/engine/pipeline/pipeline.js';

import { parseSlashInput } from './parser.js';
import { SlashStrategyDSL, type SlashDslContext } from './strategy.js';
import type { SlashDispatchDecision, SlashHandlerRequest, SlashRouterOptions } from './types.js';

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

export class SlashRouter {
  constructor(private readonly options: SlashRouterOptions) {}

  async dispatch(input: string, meta?: unknown): Promise<SlashDispatchDecision> {
    const parsed = parseSlashInput(input);

    const ctx: SlashDslContext = {
      input: {
        raw: parsed.raw,
        trimmed: parsed.trimmed,
        isSlash: parsed.kind === 'slash',
        commandName: parsed.commandName,
        argsText: parsed.argsText,
        tokens: parsed.tokens,
      },
      resolved:
        parsed.kind === 'slash'
          ? { command: this.options.registry.find(parsed.commandName!) }
          : undefined,
      data: {},
    };

    const pipeline = Pipeline.of(ctx)
      .step('slash.decide', async (context) => {
        const runner = new MicroTaskRunner<SlashDslContext>({
          debugLabel: 'SlashRouter',
          strategy: (engine) => {
            SlashStrategyDSL(engine);
            return engine;
          },
          resolveData: async () => undefined,
          maxRounds: 2,
        });
        const result = await runner.decide(context);
        return { ...context, data: { ...context.data, __plan: result.plan } };
      })
      .step('slash.execute', async (context) => {
        const plan = (context.data as any)?.__plan as ExecutionPlan | undefined;
        if (!plan) {
          return {
            ...context,
            data: { ...context.data, __decision: { kind: 'consumed' } },
          };
        }

        const action = plan.actions[0];
        if (!action) {
          return {
            ...context,
            data: { ...context.data, __decision: { kind: 'consumed' } },
          };
        }

        if (action.type !== 'EXECUTE_SLASH') {
          const decision = planToDecision(plan, {
            unknownSlashPolicy: this.options.unknownSlashPolicy,
          });
          return { ...context, data: { ...context.data, __decision: decision } };
        }

        const commandName = String((action.params as any)?.commandName ?? '');
        const spec = this.options.registry.find(commandName);
        if (!spec) {
          const decision = planToDecision(
            { ...plan, actions: [{ type: 'UNKNOWN_SLASH', params: { commandName } }] } as any,
            { unknownSlashPolicy: this.options.unknownSlashPolicy },
          );
          return { ...context, data: { ...context.data, __decision: decision } };
        }

        const handler = this.options.handlers.getHandler(spec.name);
        if (!handler) {
          return {
            ...context,
            data: {
              ...context.data,
              __decision: {
                kind: 'block',
                code: 'NO_HANDLER',
                details: { commandName: spec.name },
              },
            },
          };
        }

        const req: SlashHandlerRequest = {
          rawInput: context.input.raw,
          command: spec,
          argsText: String((action.params as any)?.argsText ?? ''),
          tokens: Array.isArray((action.params as any)?.tokens)
            ? (action.params as any).tokens
            : [],
          meta,
        };

        const result = await handler.execute(req);
        if (result.kind === 'rewrite') {
          return {
            ...context,
            data: { ...context.data, __decision: { kind: 'rewrite', input: result.input } },
          };
        }
        if (result.kind === 'forward') {
          return {
            ...context,
            data: { ...context.data, __decision: { kind: 'forward', input: result.input } },
          };
        }
        return { ...context, data: { ...context.data, __decision: { kind: 'consumed' } } };
      });

    const final = await pipeline.execute();
    if (!final.success) {
      return {
        kind: 'block',
        code: 'INTERNAL_ERROR',
        details: { message: final.error?.message, lastStep: final.lastStep },
      };
    }
    const decision = (final.data as any)?.data?.__decision as SlashDispatchDecision | undefined;
    return decision ?? { kind: 'consumed' };
  }

  async suggest(
    input: string,
    meta?: unknown,
  ): Promise<{ name: string; description: string; commandName?: string }[]> {
    const parsed = parseSlashInput(input);
    if (parsed.kind !== 'slash') return [];

    const cmdName = parsed.commandName!;
    const spec = this.options.registry.find(cmdName);
    const suggestion = parsed.suggestion;
    const argIndex = suggestion?.argIndex ?? 0;

    // Delegate to handler when a command is exactly matched and we are in the arg area.
    if (spec && argIndex > 0) {
      const handler = this.options.handlers.getHandler(spec.name);
      if (handler?.getSuggestions) {
        const items = await handler.getSuggestions({
          rawInput: parsed.raw,
          command: spec,
          argsText: parsed.argsText ?? '',
          tokens: parsed.tokens ?? [],
          meta,
        });
        return items.map((i) => ({
          name: i.name,
          description: i.description,
          commandName: spec.name,
        }));
      }
      return [];
    }

    const prefix = suggestion?.currentPrefix ?? cmdName;
    const base = this.options.registry.suggest(prefix);
    return base.map((i) => ({
      name: i.name,
      description: i.description,
      commandName: i.name.trim(),
    }));
  }
}
