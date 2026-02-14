import type { BaseDslContext, DecisionEngine } from '../grizzco/dsl/DecisionEngine.js';

import type { SlashCommandSpec } from './types.js';

export interface SlashDslContext extends BaseDslContext {
  input: {
    raw: string;
    trimmed: string;
    isSlash: boolean;
    commandName?: string;
    argsText?: string;
    tokens?: string[];
  };
  resolved?: {
    command?: SlashCommandSpec;
  };
}

/**
 * SlashStrategyDSL routes slash-prefixed inputs to command handlers.
 *
 * COMPLIANCE: DSL-Spec-V3
 * - No async/I/O here.
 * - Only declare dependencies and plan actions.
 */
export const SlashStrategyDSL = (
  engine: DecisionEngine<SlashDslContext>,
): DecisionEngine<SlashDslContext> => {
  engine
    .phase('Input Validation')
    .require((c) => typeof c.input?.raw === 'string', 'No input provided')
    .phase('Non-Slash Forwarding')
    .when(
      (c) => !c.input.isSlash,
      (p) => {
        p.setWorker('slash.forward');
        p.addAction('FORWARD_TEXT', { input: engine.ctx.input.trimmed });
      },
    )
    .phase('Slash Execution')
    .when(
      (c) => c.input.isSlash && Boolean(c.resolved?.command),
      (p) => {
        p.setWorker('slash.execute');
        p.addAction('EXECUTE_SLASH', {
          commandName: engine.ctx.resolved!.command!.name,
          argsText: engine.ctx.input.argsText ?? '',
          tokens: engine.ctx.input.tokens ?? [],
        });
      },
    )
    .phase('Unknown Slash')
    .when(
      (c) => c.input.isSlash && !c.resolved?.command,
      (p) => {
        p.setWorker('slash.unknown');
        p.addAction('UNKNOWN_SLASH', { commandName: engine.ctx.input.commandName ?? '' });
      },
    );

  return engine;
};
