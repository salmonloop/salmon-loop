import { ToolRuntimeCtx } from '../tools/types.js';

export interface SkillFrontmatter {
  name: string;
  description: string;
  allowedTools?: string[];
  context?: 'fork' | 'main';
  userInvocable?: boolean;
}

export interface Skill {
  id: string;
  path: string;
  metadata: SkillFrontmatter;
  rawContent: string; // Original Markdown
  instructions: string; // Instruction part stripped of YAML
}

/**
 * Common context for all executable units (Tools, Skills, Agents)
 */
export interface ExecutionContext extends ToolRuntimeCtx {
  traceId?: string;
  depth?: number;
}

/**
 * The standard protocol for all executable components in the system.
 * Aligns with the "Three-Layer Triage" model at the protocol level.
 */
export interface IExecutable<TInput = Record<string, any>, TOutput = any> {
  execute(inputs: TInput, ctx: ExecutionContext): Promise<TOutput>;
}

export interface SkillData {
  skill: Skill;
  inputs: Record<string, any>;
  required_sh_keys: string[];
  shell_outputs: Record<string, string>;
  prompt?: string;
  [key: string]: any; // Allow dynamic data injection for Ping-Pong protocol
}

export interface SkillExecutionResult {
  traceId: string;
  skillId: string;
  inputs: Record<string, any>;
  dynamicCommands: Array<{ cmd: string; output: string }>;
  injectedPrompt: string;
  status: 'SUCCESS' | 'FAILURE';
}
