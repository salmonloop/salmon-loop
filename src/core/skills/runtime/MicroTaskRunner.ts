import { execa } from 'execa';

import { text } from '../../../locales/index.js';
import { DecisionEngine, PlanBuilder } from '../../grizzco/dsl/DecisionEngine.js';
import { ToolRuntimeCtx } from '../../tools/types.js';
import { getPlatformShellInvocation } from '../../utils/platform-shell.js';
import { SkillParser } from '../parser.js';
import { SkillDslContext, SkillStrategyDSL } from '../strategy.js';
import { ExecutionContext, IExecutable, Skill, SkillData, SkillExecutionResult } from '../types.js';

/**
 * MicroTaskRunner manages the execution loop of a single skill.
 * COMPLIANCE: DSL-Spec-V3
 * - Computation Layer: Handles variable substitution, command extraction, and prompt assembly.
 * - Action Layer: Executes Shell commands and final Tool injection.
 */
export class MicroTaskRunner implements IExecutable<Record<string, any>, SkillExecutionResult> {
  constructor(private skill: Skill) {}

  async execute(inputs: Record<string, any>, ctx: ExecutionContext): Promise<SkillExecutionResult> {
    const skill = this.skill;
    // 1. Computation (C): Pre-calculate all dynamic dependency keys
    const rawCommands = SkillParser.extractCommands(skill.instructions || '');
    const requiredShKeys = rawCommands.map(
      (cmd) => `sh:${SkillParser.substituteVariables(cmd, inputs)}`,
    );

    const data: SkillData = {
      skill,
      inputs,
      required_sh_keys: requiredShKeys,
      shell_outputs: {},
    };

    // 2. Decision Loop (D): Drive the DSL Engine until a PLAN is reached (Ping-Pong Protocol)
    const MAX_RETRIES = 10;
    let retries = 0;

    while (true) {
      if (retries++ > MAX_RETRIES) {
        throw new Error(text.skills.maxRetriesExceeded(skill.id));
      }
      // Computation Phase (C): Pre-assemble the prompt for the DSL
      const promptLines = (skill.instructions || '')
        .split('\n')
        .filter((line: string) => !line.trim().startsWith('!'));
      data.prompt = SkillParser.substituteVariables(promptLines.join('\n').trim(), inputs);

      const dslCtx: SkillDslContext = {
        ...ctx,
        data,
        skillId: skill.id,
        path: skill.path,
      };

      const engine = new DecisionEngine<SkillDslContext>(
        dslCtx,
        new PlanBuilder<SkillDslContext>(),
      );
      const result = SkillStrategyDSL(engine).build();

      if (result.type === 'NEED_DATA') {
        // COMPLIANCE: DSL-Spec-V3 Ping-Pong
        await this.handleMissingData(result.keys ?? [result.key], data, ctx);
        continue;
      }

      const plan = result.plan;
      const injectAction = plan.actions.find((a) => a.type === 'INJECT_PROMPT');

      return {
        traceId: `skill-${skill.id}-${Date.now()}`,
        skillId: skill.id,
        inputs,
        dynamicCommands: Object.entries(data.shell_outputs).map(([cmd, output]) => ({
          cmd,
          output: output as string,
        })),
        injectedPrompt: injectAction?.params?.prompt || '',
        status: plan.shouldAbort ? 'FAILURE' : 'SUCCESS',
      };
    }
  }

  private async handleMissingData(
    keys: string[],
    data: SkillData,
    ctx: ToolRuntimeCtx,
  ): Promise<void> {
    for (const key of keys) {
      if (key.startsWith('sh:')) {
        const command = key.slice(3);
        const output = await this.executeCommand(command, ctx);
        data.shell_outputs[command] = output;
        data[key] = output; // Satisfy DecisionEngine dependency
      }
    }
  }

  /**
   * Action (A): Physical Shell execution
   */
  private async executeCommand(command: string, ctx: ToolRuntimeCtx): Promise<string> {
    if (ctx.dryRun) return `[DRY_RUN] Executing: ${command}`;
    try {
      const shell = getPlatformShellInvocation(command);
      const { stdout } = await execa(shell.file, shell.args, {
        cwd: ctx.repoRoot,
        env: {
          ...process.env,
          SALMONLOOP_REPO_ROOT: ctx.repoRoot,
          SALMONLOOP_ATTEMPT_ID: String(ctx.attemptId),
        },
      });
      return stdout.trim();
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}
