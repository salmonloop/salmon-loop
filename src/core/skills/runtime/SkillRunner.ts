import * as crypto from 'crypto';

import { MicroTaskRunner } from '../../grizzco/dsl/MicroTaskRunner.js';
import { tryGetLogger } from '../../observability/logger.js';
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

/**
 * Resolve the effective allowed-tools set for a skill.
 *
 * Uses only the AgentSkills spec field (`allowed-tools`, space-delimited string)
 * and returns a single `Set<string>`. Returns `null` when the field is not
 * declared, meaning the skill places no tool restrictions.
 *
 * Distinguishes three states:
 * - Field not declared → `null` (no restriction)
 * - Field declared but empty (`""`) → empty `Set` (deny all tools)
 * - Field declared with values → `Set` containing those tool names
 *
 * @see https://agentskills.io/specification — allowed-tools field
 */
function resolveAllowedTools(skill: Skill): Set<string> | null {
  const specField = skill.metadata?.['allowed-tools'];
  if (specField === undefined) return null;
  if (!specField.trim()) return new Set<string>();
  return new Set(specField.split(/\s+/).filter(Boolean));
}

/**
 * Match a tool name against an allowed-tools pattern.
 *
 * Supports two modes:
 * - Exact match: pattern contains no `*` → strict string equality
 * - Glob match: pattern contains `*` → each `*` matches zero or more characters
 *
 * Case-sensitive. Only `*` is treated as special; no `?` or `[...]` ranges.
 *
 * Uses an iterative segment-matching algorithm (no regex) to avoid ReDoS risk.
 *
 * @param pattern - An allowed-tools entry (e.g. "shell.*", "code.search")
 * @param toolName - The tool name to check (e.g. "shell.exec")
 * @returns true if toolName matches the pattern
 */
export function matchAllowedTool(pattern: string, toolName: string): boolean {
  // Split pattern on '*' into literal segments
  const segments = pattern.split('*');

  // No wildcard → exact match
  if (segments.length === 1) {
    return pattern === toolName;
  }

  const first = segments[0];
  const last = segments[segments.length - 1];

  // toolName must start with the first segment
  if (!toolName.startsWith(first)) {
    return false;
  }

  // toolName must end with the last segment
  if (!toolName.endsWith(last)) {
    return false;
  }

  // Guard: the tool name must be long enough to contain all literal segments
  // without overlap between the first/last anchors
  let pos = first.length;
  const endBound = toolName.length - last.length;

  // Match each middle segment in order (greedy left-to-right scan)
  for (let i = 1; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg === '') {
      // Consecutive '*' — matches any amount of characters, skip
      continue;
    }
    const idx = toolName.indexOf(seg, pos);
    if (idx === -1 || idx + seg.length > endBound) {
      return false;
    }
    pos = idx + seg.length;
  }

  return pos <= endBound;
}

/**
 * Check whether a tool name is permitted by the allowed-tools set.
 *
 * @param toolName - The tool name to check
 * @param allowedTools - The resolved allowed-tools set, or null for no restriction
 * @returns true if the tool is permitted
 */
export function isToolPermitted(toolName: string, allowedTools: Set<string> | null): boolean {
  // null means no restriction — all tools permitted
  if (allowedTools === null) {
    return true;
  }

  // Iterate entries; return true if any pattern matches
  for (const pattern of allowedTools) {
    if (matchAllowedTool(pattern, toolName)) {
      return true;
    }
  }

  return false;
}

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
  const allowedTools = resolveAllowedTools(skill);

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
        const toolName = 'shell.exec';

        // Enforce allowed-tools constraint from skill frontmatter.
        // When declared, only pre-approved tools may be invoked.
        // Uses isToolPermitted for glob pattern matching support.
        if (!isToolPermitted(toolName, allowedTools)) {
          const logger = tryGetLogger();
          logger?.warn(
            `Skill "${skill.id}" attempted to use tool "${toolName}" which is not in allowed-tools: [${[...(allowedTools ?? [])].join(', ')}]`,
          );
          emitSkillAuditEvent({
            type: 'SKILL_EXECUTION_DENIED',
            skillId: skill.id,
            route,
            runnerClass: 'MicroTaskRunner',
            commandCount: rawCommands.length,
            authorizationMode: 'blocking',
            argsHash,
            traceId,
            denyReason: 'ALLOWED_TOOLS_VIOLATION',
            denySource: `skill-frontmatter:allowed-tools`,
            durationMs: Date.now() - startedAt,
          });
          throw new Error(
            `Tool "${toolName}" is not permitted by skill "${skill.id}" allowed-tools policy`,
          );
        }

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
