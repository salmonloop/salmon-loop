import * as os from 'os';
import * as path from 'path';

import { logger } from '../../core/observability/logger.js';
import { skillToToolSpec } from '../../core/skills/bridge.js';
import { SkillParser } from '../../core/skills/parser.js';
import type { Skill } from '../../core/skills/types.js';
import { registerAllBuiltins } from '../../core/tools/builtin/index.js';
import { ToolRegistry } from '../../core/tools/registry.js';
import type { SideEffect } from '../../core/tools/types.js';
import {
  existsSync,
  readFileUtf8,
  readFileUtf8Sync,
  readdirDirents,
  readdirDirentsSync,
  safePathJoin,
  stat,
  statSync,
} from '../utils/safe-fs.js';

const VALID_SIDE_EFFECTS = new Set<SideEffect>([
  'none',
  'fs_read',
  'fs_write',
  'process',
  'network',
  'git_read',
  'git_write',
]);

const toolNameCache = new Map<string, { names: Set<string>; signature: string }>();

async function loadSkillsFromPath(root: string): Promise<Skill[]> {
  if (!existsSync(root)) return [];
  const entries = await readdirDirents(root, root);
  const skills: Skill[] = [];

  for (const entry of entries) {
    const skillFile = entry.isDirectory()
      ? safePathJoin(root, entry.name, 'SKILL.md')
      : entry.name.endsWith('.md')
        ? safePathJoin(root, entry.name)
        : null;

    if (!skillFile || !existsSync(skillFile, root)) continue;

    try {
      const content = await readFileUtf8(skillFile, root);
      skills.push(SkillParser.parse(content, skillFile));
    } catch (error) {
      logger.warn(
        `Failed to load skill at ${skillFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return skills;
}

function getSkillSearchPaths(repoRoot: string): string[] {
  return [
    path.join(os.homedir(), '.claude/skills'),
    path.join(repoRoot, '.salmonloop/skills'),
    path.join(repoRoot, '.claude/skills'),
  ];
}

async function computeSkillSignature(repoRoot: string): Promise<string> {
  const parts: string[] = [];
  for (const searchPath of getSkillSearchPaths(repoRoot)) {
    try {
      const stats = await stat(searchPath);
      parts.push(`${searchPath}:${stats.mtimeMs}`);
    } catch {
      parts.push(`${searchPath}:missing`);
    }
  }
  return parts.join('|');
}

function computeSkillSignatureSync(repoRoot: string): string {
  const parts: string[] = [];
  for (const searchPath of getSkillSearchPaths(repoRoot)) {
    try {
      const stats = statSync(searchPath);
      parts.push(`${searchPath}:${stats.mtimeMs}`);
    } catch {
      parts.push(`${searchPath}:missing`);
    }
  }
  return parts.join('|');
}

function loadSkillsFromPathSync(root: string): Skill[] {
  if (!existsSync(root)) return [];
  const entries = readdirDirentsSync(root, root);
  const skills: Skill[] = [];

  for (const entry of entries) {
    const skillFile = entry.isDirectory()
      ? safePathJoin(root, entry.name, 'SKILL.md')
      : entry.name.endsWith('.md')
        ? safePathJoin(root, entry.name)
        : null;

    if (!skillFile || !existsSync(skillFile, root)) continue;

    try {
      const content = readFileUtf8Sync(skillFile, root);
      skills.push(SkillParser.parse(content, skillFile));
    } catch (error) {
      logger.warn(
        `Failed to load skill at ${skillFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return skills;
}

export async function getKnownToolNames(repoRoot: string): Promise<Set<string>> {
  const signature = await computeSkillSignature(repoRoot);
  const cached = toolNameCache.get(repoRoot);
  if (cached && cached.signature === signature) return cached.names;

  const registry = new ToolRegistry();
  registerAllBuiltins(registry);

  for (const searchPath of getSkillSearchPaths(repoRoot)) {
    const skills = await loadSkillsFromPath(searchPath);
    for (const skill of skills) {
      try {
        registry.register(skillToToolSpec(skill));
      } catch (error) {
        const label = skill.metadata?.name || skill.id;
        logger.warn(
          `Failed to register skill ${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const names = new Set(registry.listAll().map((spec) => spec.name));
  toolNameCache.set(repoRoot, { names, signature });
  return names;
}

export function getKnownToolNamesSync(repoRoot: string): Set<string> {
  const signature = computeSkillSignatureSync(repoRoot);
  const cached = toolNameCache.get(repoRoot);
  if (cached && cached.signature === signature) return cached.names;

  const registry = new ToolRegistry();
  registerAllBuiltins(registry);

  for (const searchPath of getSkillSearchPaths(repoRoot)) {
    const skills = loadSkillsFromPathSync(searchPath);
    for (const skill of skills) {
      try {
        registry.register(skillToToolSpec(skill));
      } catch (error) {
        const label = skill.metadata?.name || skill.id;
        logger.warn(
          `Failed to register skill ${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const names = new Set(registry.listAll().map((spec) => spec.name));
  toolNameCache.set(repoRoot, { names, signature });
  return names;
}

export function clearKnownToolNames(repoRoot?: string): void {
  if (repoRoot) {
    toolNameCache.delete(repoRoot);
    return;
  }
  toolNameCache.clear();
}

export function validateSideEffects(raw?: string[]): { valid?: SideEffect[]; invalid?: string[] } {
  if (!raw || raw.length === 0) return {};
  const invalid = raw.filter((effect) => !VALID_SIDE_EFFECTS.has(effect as SideEffect));
  if (invalid.length > 0) return { invalid };
  return { valid: raw as SideEffect[] };
}
