import os from 'node:os';
import path from 'node:path';

import { text } from '../../locales/index.js';
import { syncFs as fs } from '../adapters/fs/node-fs.js';
import { tryGetLogger } from '../observability/logger.js';

import { matchGlob } from './discovery.js';
import { getSkillFeatureFlags } from './feature-flags.js';
import { SkillParser } from './parser.js';
import { Skill, SkillCatalogEntry } from './types.js';

/**
 * Safe logger accessor that never throws when the logger is not yet initialized.
 *
 * Falls back to a no-op stub so that loader code can run in test environments
 * or early startup paths where the global logger has not been set.
 */
function safeLogger() {
  return tryGetLogger() ?? {
    error: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    info: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    audit: (..._args: unknown[]) => {},
  };
}

export interface SkillLoaderOptions {
  repoRoot: string;
  useDefaults?: boolean;
  extraPaths?: string[];
  /** Enable legacy direct .md file loading (deprecated). Default: false */
  legacyDirectMd?: boolean;
}

type SearchPath = { path: string; label: string };

export class SkillLoader {
  /**
   * Format the skill catalog into a model-consumable disclosure block.
   *
   * Pure data contract: accepts catalog + optional context paths, returns string.
   * No dependency on session or prompt layer.
   *
   * Filtering logic:
   * 1. Exclude entries where `userInvocable === false`.
   * 2. For entries with `conditionalPaths`: include only if at least one
   *    context file path matches a conditional path pattern. If no
   *    `contextFilePaths` provided, exclude conditional skills.
   * 3. Non-conditional skills with `userInvocable !== false` are always included.
   *
   * @param catalog - Array of SkillCatalogEntry from loadCatalog()
   * @param contextFilePaths - Optional list of currently open/relevant file paths
   *   for conditional skill filtering
   * @returns Formatted string with preamble + skill entries, or empty string if
   *   no disclosable skills
   * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
   */
  static formatCatalogDisclosure(
    catalog: SkillCatalogEntry[],
    contextFilePaths?: string[],
  ): string {
    const disclosable = catalog.filter(entry => {
      // Exclude non-user-invocable skills
      if (entry.userInvocable === false) {
        return false;
      }

      // Handle conditional skills (those with conditionalPaths)
      if (entry.conditionalPaths && entry.conditionalPaths.length > 0) {
        // No context file paths provided → exclude conditional skills
        if (!contextFilePaths || contextFilePaths.length === 0) {
          return false;
        }
        // Include only if at least one context file path matches a conditional path pattern
        return entry.conditionalPaths.some(pattern =>
          contextFilePaths.some(fp => matchGlob(fp, pattern)),
        );
      }

      // Non-conditional, user-invocable skills are always included
      return true;
    });

    if (disclosable.length === 0) {
      return '';
    }

    const preamble = `## Available Skills\n\n${text.skills.catalogDisclosurePreamble}`;
    const entries = disclosable
      .map(entry => `- **${entry.name}**: ${entry.description}\n  Location: ${entry.location}`)
      .join('\n\n');

    return `${preamble}\n\n${entries}\n`;
  }

  /** Cache of fully activated skills (Tier 2). */
  private readonly activated = new Map<string, Skill>();

  /** Cached catalog entries from the last loadCatalog() call. */
  private catalogCache: SkillCatalogEntry[] | null = null;

  constructor(private readonly options: SkillLoaderOptions) {}

  /**
   * Tier 2: Activate a skill by id — load full SKILL.md content on demand.
   *
   * Looks up the skill in the catalog (loading it first if necessary),
   * reads the full file content, parses it with {@link SkillParser.parse},
   * and caches the result. Subsequent calls for the same id return the
   * cached {@link Skill} without re-reading the file.
   *
   * @param id - The skill identifier (must match a catalog entry)
   * @returns The fully loaded {@link Skill} with instructions
   * @throws Error if the skill id is not found in the catalog
   * @see Requirements 6.2, 6.4
   */
  async activateSkill(id: string): Promise<Skill> {
    // Return cached activation if already loaded
    const cached = this.activated.get(id);
    if (cached) {
      return cached;
    }

    // Ensure catalog is available
    if (!this.catalogCache) {
      this.catalogCache = await this.loadCatalog();
    }

    const entry = this.catalogCache.find(e => e.id === id);
    if (!entry) {
      throw new Error(text.skills.skillNotFoundInCatalog(id));
    }

    // Read full content and parse with SkillParser
    const content = fs.readFileSync(entry.location, 'utf-8');
    const isLegacyFile = !entry.location.endsWith('SKILL.md');
    const flags = getSkillFeatureFlags();
    const strict = flags.parserStrict && !isLegacyFile;
    const skill = SkillParser.parse(content, entry.location, strict);

    this.activated.set(id, skill);
    safeLogger().info(text.skills.skillActivated(id));

    return skill;
  }

  /**
   * Tier 1: Load a lightweight catalog of all discoverable skills.
   *
   * Parses only YAML frontmatter (name + description + location) without
   * loading full instruction content. Keeps startup context cost at
   * approximately 50-100 tokens per skill.
   *
   * Uses the same search path priority and conflict resolution as
   * {@link initialize}, but avoids reading instruction bodies.
   *
   * @returns Array of {@link SkillCatalogEntry} in discovery priority order
   * @see Requirements 6.1, 6.3
   */
  async loadCatalog(): Promise<SkillCatalogEntry[]> {
    const catalog: SkillCatalogEntry[] = [];
    const seen = new Map<string, string>();
    const flags = getSkillFeatureFlags();

    for (const target of this.buildSearchPaths()) {
      if (!fs.existsSync(target.path)) continue;

      const scope = this.labelToScope(target.label);
      const entries = fs.readdirSync(target.path, { withFileTypes: true });

      for (const entry of entries) {
        let skillFile: string | null = null;
        if (entry.isDirectory()) {
          skillFile = path.join(target.path, entry.name, 'SKILL.md');
        } else if (entry.name.endsWith('.md') && this.options.legacyDirectMd) {
          skillFile = path.join(target.path, entry.name);
          safeLogger().warn(text.skills.legacyDirectMdDeprecation(skillFile));
        }

        if (!skillFile || !fs.existsSync(skillFile)) continue;

        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const isLegacyFile = !entry.isDirectory();
          const strict = flags.parserStrict && !isLegacyFile;
          const catalogEntry = SkillParser.parseFrontmatterOnly(
            content,
            skillFile,
            scope,
            strict,
          );

          if (seen.has(catalogEntry.id)) {
            const firstSource = seen.get(catalogEntry.id)!;
            safeLogger().warn(
              `Duplicate skill ${catalogEntry.id} found in ${skillFile}; already loaded from ${firstSource}`,
            );
            safeLogger().audit(
              'SKILL_DUPLICATE_SKIPPED',
              {
                skillId: catalogEntry.id,
                skippedPath: skillFile,
                firstSource,
                reason: 'first_win_conflict_resolution',
              },
              { source: 'skill-loader', severity: 'low', scope: 'repo' },
            );
            continue;
          }
          seen.set(catalogEntry.id, `${target.label}:${skillFile}`);
          catalog.push(catalogEntry);
        } catch (err) {
          safeLogger().error(
            `Failed to load skill catalog entry at ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    this.catalogCache = catalog;
    return catalog;
  }

  async initialize(): Promise<Skill[]> {
    return this.loadSkillsFromPaths();
  }

  /**
   * Synchronous variant of {@link initialize} for callers that cannot await.
   *
   * Safe because all underlying I/O uses `syncFs` (synchronous fs operations).
   * Used by tool-name discovery for tab completion.
   */
  initializeSync(): Skill[] {
    return this.loadSkillsFromPaths();
  }

  private loadSkillsFromPaths(): Skill[] {
    const inventory: Skill[] = [];
    const seen = new Map<string, string>();
    const flags = getSkillFeatureFlags();

    for (const target of this.buildSearchPaths()) {
      if (!fs.existsSync(target.path)) continue;

      const entries = fs.readdirSync(target.path, { withFileTypes: true });
      for (const entry of entries) {
        let skillFile: string | null = null;
        if (entry.isDirectory()) {
          skillFile = path.join(target.path, entry.name, 'SKILL.md');
        } else if (entry.name.endsWith('.md') && this.options.legacyDirectMd) {
          skillFile = path.join(target.path, entry.name);
          safeLogger().warn(text.skills.legacyDirectMdDeprecation(skillFile));
        }

        if (!skillFile || !fs.existsSync(skillFile)) continue;

        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const isLegacyFile = !entry.isDirectory();
          const strict = flags.parserStrict && !isLegacyFile;
          const skill = SkillParser.parse(content, skillFile, strict);
          if (seen.has(skill.id)) {
            const firstSource = seen.get(skill.id)!;
            safeLogger().warn(
              `Duplicate skill ${skill.id} found in ${skillFile}; already loaded from ${firstSource}`,
            );
            safeLogger().audit(
              'SKILL_DUPLICATE_SKIPPED',
              {
                skillId: skill.id,
                skippedPath: skillFile,
                firstSource,
                reason: 'first_win_conflict_resolution',
              },
              { source: 'skill-loader', severity: 'low', scope: 'repo' },
            );
            continue;
          }
          seen.set(skill.id, `${target.label}:${skillFile}`);
          inventory.push(skill);
        } catch (err) {
          safeLogger().error(
            `Failed to load skill at ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return inventory;
  }

  /**
   * Derive the catalog scope from a search path label.
   *
   * Labels follow the pattern `prefix:path` where prefix is one of:
   * - `config` → 'config' scope (extra paths from skills.json)
   * - `repo` → 'repo' scope (repo-level directories)
   * - `user` → 'user' scope (user home directories)
   * - `compat` → 'repo' scope for repo-level compat paths, 'user' for user-level
   */
  private labelToScope(label: string): 'repo' | 'user' | 'config' {
    if (label.startsWith('config:')) return 'config';
    if (label.startsWith('user:')) return 'user';
    if (label.startsWith('compat:~')) return 'user';
    // repo: and compat: (non-home) are repo scope
    return 'repo';
  }

  /**
   * Build the ordered list of skill search paths.
   *
   * Priority (high → low):
   *   1. Config extra paths (from skills.json discovery.paths)
   *   2. {repoRoot}/.salmonloop/skills
   *   3. {repoRoot}/.agents/skills        (cross-client interop)
   *   4. {repoRoot}/.claude/skills         (compat, when useDefaults=true)
   *   5. ~/.salmonloop/skills
   *   6. ~/.agents/skills                  (cross-client interop)
   *   7. ~/.claude/skills                  (compat, when useDefaults=true)
   *
   * First-win conflict resolution: when two skills share the same name,
   * the one from the higher-priority path wins and a warning is logged
   * (handled in initialize()).
   */
  private buildSearchPaths(): SearchPath[] {
    const paths: SearchPath[] = [];
    const useDefaults = this.options.useDefaults ?? true;

    // 1. Config extra paths (highest priority)
    const extra = this.options.extraPaths ?? [];
    for (const extraPath of extra) {
      paths.push({ path: extraPath, label: `config:${extraPath}` });
    }

    // 2. Repo-level .salmonloop/skills
    paths.push({
      path: path.join(this.options.repoRoot, '.salmonloop', 'skills'),
      label: 'repo:.salmonloop/skills',
    });

    // 3. Repo-level .agents/skills (cross-client interop)
    paths.push({
      path: path.join(this.options.repoRoot, '.agents', 'skills'),
      label: 'repo:.agents/skills',
    });

    // 4. Repo-level .claude/skills (compat)
    if (useDefaults) {
      paths.push({
        path: path.join(this.options.repoRoot, '.claude', 'skills'),
        label: 'compat:.claude/skills',
      });
    }

    // 5. User-level ~/.salmonloop/skills
    paths.push({
      path: path.join(os.homedir(), '.salmonloop', 'skills'),
      label: 'user:~/.salmonloop/skills',
    });

    // 6. User-level ~/.agents/skills (cross-client interop)
    paths.push({
      path: path.join(os.homedir(), '.agents', 'skills'),
      label: 'user:~/.agents/skills',
    });

    // 7. User-level ~/.claude/skills (compat)
    if (useDefaults) {
      paths.push({
        path: path.join(os.homedir(), '.claude', 'skills'),
        label: 'compat:~/.claude/skills',
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
