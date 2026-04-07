import * as crypto from 'crypto';

import { MicroTaskRunner } from '../../grizzco/dsl/MicroTaskRunner.js';
import type { ToolRouter } from '../../tools/router.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import { Phase } from '../../types/index.js';
import {
  emitSkillAuditEvent,
  generateSkillTraceId,
  hashSkillArgs,
} from '../audit.js';
import { SkillParser } from '../parser.js';
import { SkillStrategyDSL, type SkillDslContext } from '../strategy.js';
import type { Skill, SkillData, SkillExecutionResult } from '../types.js';

export interface ExecuteSkillOptions {
  skill: Skill;
  argsText: string;
  toolRouter: ToolRouter;
  toolCtx: ToolRuntimeCtx;
  signal?: AbortSignal;
  /** Execution route for audit tracking. Defaults to 'slash-governed'. */
  route?: 'slash-governed' | 'tool-bridge';
}

function buildStableId(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

function formatShellTranscript(shellOutputs: Record<string, string>): string {
  const entries = Object.entries(shellOutputs);
  if (entries.length === 0) return '';
  const lines: string[] = [];
  lines.push('');
  lines.push('## Skill Shell Outputs');
  for (const [cmd, out] of entries) {
    lines.push('');
    lines.push(`$ ${cmd}`);
    lines.push(out ? out : '(no output)');
  }
  return lines.join('\n');
}

/**
 * Execute a skill using the Grizzco MicroTaskRunner (DSL-Spec-V3 Ping-Pong).
 *
 * - Computation layer: parses instructions, extracts shell dependencies, assembles prompt.
 * - Decision layer: SkillStrategyDSL declares required keys and emits INJECT_PROMPT.
 * - Action layer: resolves sh:* keys through ToolRouter (governed + auditable).
 */
export async function executeSkill(options: ExecuteSkillOptions): Promise<SkillExecutionResult> {
  const { skill, argsText, toolRouter, toolCtx, signal } = options;
  const route = options.route ?? 'slash-governed';

  const inputs = { args: argsText ?? '' };
  const rawCommands = SkillParser.extractCommands(skill.instructions || '');
  const traceId = generateSkillTraceId(skill.id);
  const argsHash = hashSkillArgs(argsText);
  const startedAt = Date.now();

  // Emit SKILL_EXECUTION_START before execution
  emitSkillAuditEvent({
    type: 'SKILL_EXECUTION_START',
    skillId: skill.id,
    route,
    runnerClass: 'MicroTaskRunner',
    commandCount: rawCommands.length,
    authorizationMode: 'blocking',
    argsHash,
    traceId,
  });

  const requiredShKeys = rawCommands.map(
    (cmd) => `sh:${SkillParser.substituteVariables(cmd, inputs)}`,
  );

  const data: SkillData = {
    skill,
    inputs,
    required_sh_keys: requiredShKeys,
    shell_outputs: {},
  };

  const ctx: SkillDslContext = {
    data,
    skillId: skill.id,
    path: skill.path,
  };

  try {
    const runner = new MicroTaskRunner<SkillDslContext>({
      debugLabel: `SkillRunner:${skill.id}`,
      maxRounds: 10,
      strategy: (engine) => {
        // Computation phase: assemble a prompt without any "!..." lines.
        const promptLines = (skill.instructions || '')
          .split('\n')
          .filter((line) => !line.trim().startsWith('!'));
        const basePrompt = SkillParser.substituteVariables(promptLines.join('\n').trim(), inputs);
        const transcript = formatShellTranscript(data.shell_outputs as any);
        data.prompt = `${basePrompt}${transcript}`.trim();

        SkillStrategyDSL(engine);
        return engine;
      },
      resolveData: async (_ctx, key) => {
        if (!key.startsWith('sh:')) {
          return undefined;
        }

        const command = key.slice(3);
        const callId = `slash-sh-${buildStableId([skill.id, command])}`;
        const envelope = {
          id: callId,
          phase: Phase.SLASH,
          toolName: 'shell.exec',
          args: { command },
          ctx: {
            ...toolCtx,
            // Ensure ToolPolicy sees worktree isolation for process execution.
            worktreeRoot: toolCtx.worktreeRoot ?? toolCtx.repoRoot,
          },
        } as const;

        let result = await toolRouter.call(envelope as any);
        if (result.status === 'denied' && result.error?.code === 'AUTH_REQUIRED') {
          await toolRouter.waitForAuthorization(callId, signal);
          result = await toolRouter.call(envelope as any);
        }

        if (result.status !== 'ok') {
          const msg = result.error?.message || 'shell.exec failed';
          // Emit SKILL_EXECUTION_DENIED for command-level denial
          if (result.status === 'denied') {
            emitSkillAuditEvent({
              type: 'SKILL_EXECUTION_DENIED',
              skillId: skill.id,
              route,
              runnerClass: 'MicroTaskRunner',
              commandCount: rawCommands.length,
              authorizationMode: 'blocking',
              argsHash,
              traceId,
              denyReason: result.error?.code || 'unknown',
              denySource: (result.meta as any)?.authorization?.source || 'policy',
              durationMs: Date.now() - startedAt,
            });
          }
          throw new Error(msg);
        }

        const output = result.output as { ok: boolean; stdout: string; stderr: string };
        const combined = [output.stdout, output.stderr].filter(Boolean).join('\n').trim();
        (data.shell_outputs as any)[command] = combined;
        (data as any)[key] = combined;
        return combined;
      },
    });

    const decided = await runner.decide(ctx);
    const plan = decided.plan;
    const inject = plan.actions.find((a) => a.type === 'INJECT_PROMPT');
    const status = plan.shouldAbort ? 'FAILURE' : 'SUCCESS';

    // Emit SKILL_EXECUTION_END after successful execution
    emitSkillAuditEvent({
      type: 'SKILL_EXECUTION_END',
      skillId: skill.id,
      route,
      runnerClass: 'MicroTaskRunner',
      commandCount: rawCommands.length,
      authorizationMode: 'blocking',
      argsHash,
      traceId,
      durationMs: Date.now() - startedAt,
    });

    return {
      traceId,
      skillId: skill.id,
      inputs,
      dynamicCommands: Object.entries(data.shell_outputs).map(([cmd, output]) => ({
        cmd,
        output: String(output),
      })),
      injectedPrompt: String((inject?.params as any)?.prompt ?? ''),
      status,
    };
  } catch (error) {
    // Emit SKILL_EXECUTION_END on failure (non-denial errors)
    emitSkillAuditEvent({
      type: 'SKILL_EXECUTION_END',
      skillId: skill.id,
      route,
      runnerClass: 'MicroTaskRunner',
      commandCount: rawCommands.length,
      authorizationMode: 'blocking',
      argsHash,
      traceId,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
