import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { logger } from '../logger.js';

import { SkillParser } from './parser.js';
import { Skill } from './types.js';

export class SkillLoader {
  private readonly searchPaths = [
    path.join(os.homedir(), '.claude/skills'),
    path.join(process.cwd(), '.salmonloop/skills'),
    path.join(process.cwd(), '.claude/skills'),
  ];

  async initialize(): Promise<Skill[]> {
    const inventory: Skill[] = [];
    for (const p of this.searchPaths) {
      if (!fs.existsSync(p)) continue;

      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = path.join(p, entry.name, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            try {
              const content = fs.readFileSync(skillFile, 'utf-8');
              inventory.push(SkillParser.parse(content, skillFile));
            } catch (err) {
              logger.error(
                `Failed to load skill at ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } else if (entry.name.endsWith('.md')) {
          const skillFile = path.join(p, entry.name);
          try {
            const content = fs.readFileSync(skillFile, 'utf-8');
            inventory.push(SkillParser.parse(content, skillFile));
          } catch (err) {
            logger.error(
              `Failed to load skill at ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
    return inventory;
  }
}
