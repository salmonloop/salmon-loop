import os from 'node:os';
import path from 'node:path';

import { syncFs as fs } from '../adapters/fs/node-fs.js';
import { getLogger } from '../observability/logger.js';

import { SkillParser } from './parser.js';
import { Skill } from './types.js';

export interface SkillLoaderOptions {
  repoRoot: string;
  useDefaults?: boolean;
  extraPaths?: string[];
}

type SearchPath = { path: string; label: string };

export class SkillLoader {
  constructor(private readonly options: SkillLoaderOptions) {}

  async initialize(): Promise<Skill[]> {
    const inventory: Skill[] = [];
    const seen = new Map<string, string>();

    for (const target of this.buildSearchPaths()) {
      if (!fs.existsSync(target.path)) continue;

      const entries = fs.readdirSync(target.path, { withFileTypes: true });
      for (const entry of entries) {
        let skillFile: string | null = null;
        if (entry.isDirectory()) {
          skillFile = path.join(target.path, entry.name, 'SKILL.md');
        } else if (entry.name.endsWith('.md')) {
          skillFile = path.join(target.path, entry.name);
        }

        if (!skillFile || !fs.existsSync(skillFile)) continue;

        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const skill = SkillParser.parse(content, skillFile);
          if (seen.has(skill.id)) {
            getLogger().warn(
              `Duplicate skill ${skill.id} found in ${skillFile}; already loaded from ${seen.get(
                skill.id,
              )}`,
            );
            continue;
          }
          seen.set(skill.id, `${target.label}:${skillFile}`);
          inventory.push(skill);
        } catch (err) {
          getLogger().error(
            `Failed to load skill at ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return inventory;
  }

  private buildSearchPaths(): SearchPath[] {
    const paths: SearchPath[] = [];

    const extra = this.options.extraPaths ?? [];
    for (const extraPath of extra) {
      paths.push({ path: extraPath, label: `config:${extraPath}` });
    }

    paths.push({
      path: path.join(this.options.repoRoot, '.salmonloop', 'skills'),
      label: 'repo:.salmonloop/skills',
    });

    paths.push({
      path: path.join(os.homedir(), '.salmonloop', 'skills'),
      label: 'user:~/.salmonloop/skills',
    });

    if (this.options.useDefaults ?? true) {
      paths.push({
        path: path.join(os.homedir(), '.claude', 'skills'),
        label: 'compat:~/.claude/skills',
      });
      paths.push({
        path: path.join(this.options.repoRoot, '.claude', 'skills'),
        label: 'compat:.claude/skills',
      });
    }

    const deduped: SearchPath[] = [];
    const seen = new Set<string>();
    for (const entry of paths) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      deduped.push(entry);
    }
    return deduped;
  }
}
