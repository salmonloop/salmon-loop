import { BaseDslContext, DecisionEngine } from '../grizzco/dsl/DecisionEngine.js';

import { SkillData } from './types.js';

export interface SkillDslContext extends BaseDslContext {
  data: SkillData;
  skillId: string;
  path: string;
}

/**
 * SkillStrategyDSL implements the skill decision logic using the project's standard DecisionEngine.
 * COMPLIANCE: DSL-Spec-V3 (Bifrost Architecture)
 * 1. Purity: The DSL ONLY evaluates rules and declares dependencies.
 * 2. No Logic: Computation (string manipulation, parsing) is forbidden here.
 */
export const SkillStrategyDSL = (
  engine: DecisionEngine<SkillDslContext>,
): DecisionEngine<SkillDslContext> => {
  return (
    engine
      .phase('Context Discovery')
      .require((c) => !!c.data.skill, 'No skill context provided')
      .require((c) => !!c.data.skill.instructions, 'Skill has no instructions')

      .phase('Dynamic Data Dependencies')
      .apply((e) => {
        // Declarative dependencies: The list of sh: keys is pre-computed by the Computation layer.
        const keys = e.ctx.data.required_sh_keys || [];
        for (const key of keys) {
          e.requireData(key);
        }
        return e;
      })

      .phase('Prompt Assembly')
      // The DSL only decides WHICH worker to use.
      .when(
        (c) => !!c.data.prompt,
        (p) => {
          const prompt = engine.ctx.data.prompt;

          p.setWorker('skill-prompt-assembler');
          p.addAction('INJECT_PROMPT', { prompt });
        },
      )
  );
};
