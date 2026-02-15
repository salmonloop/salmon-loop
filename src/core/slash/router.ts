import { Pipeline } from '../grizzco/engine/pipeline/pipeline.js';

import { parseSlashInput } from './parser.js';
import { buildSlashDecideStep } from './steps/slash-decide.js';
import { buildSlashExecuteStep } from './steps/slash-execute.js';
import type { SlashDslContext } from './strategy.js';
import type { SlashDispatchDecision, SlashRouterOptions } from './types.js';

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

    const final = await Pipeline.of(ctx)
      .step('slash.decide', buildSlashDecideStep())
      .step('slash.execute', buildSlashExecuteStep(this.options, meta))
      .execute();
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
