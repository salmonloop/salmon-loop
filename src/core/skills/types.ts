import { ToolRuntimeCtx } from '../tools/types.js';

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** AgentSkills spec field: space-delimited string (normalized from array if needed). */
  'allowed-tools'?: string;
  /** SalmonLoop extension: array form (normalized from string if needed). */
  allowedTools?: string[];
  context?: 'fork' | 'main';
  userInvocable?: boolean;
  paths?: string[];
}

export interface Skill {
  id: string;
  path: string;
  metadata: SkillFrontmatter;
  rawContent: string; // Original Markdown
  instructions: string; // Instruction part stripped of YAML
}

/**
 * Tier 1 catalog entry: lightweight metadata loaded at startup.
 *
 * Contains only frontmatter fields (name + description + location) to keep
 * startup context cost at approximately 50-100 tokens per skill.
 *
 * @see Requirements 6.1, 6.3
 */
export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  location: string;
  scope: 'repo' | 'user' | 'config';
  conditionalPaths?: string[];
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
