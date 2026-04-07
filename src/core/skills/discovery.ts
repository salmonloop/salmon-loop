import { text } from '../../locales/index.js';
import { getLogger } from '../observability/logger.js';

import { SkillCatalogEntry } from './types.js';

/**
 * Check whether a file path matches a glob-like pattern.
 *
 * Supports:
 * - `**` to match any number of path segments
 * - `*` to match any characters within a single path segment
 * - Literal path matching
 *
 * @param filePath - The file path to test (forward-slash normalized)
 * @param pattern - The glob pattern to match against
 * @returns true if the file path matches the pattern
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  // Normalize separators to forward slash for consistent matching
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Build regex from glob pattern character by character
  let regexStr = '';
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === '*' && normalizedPattern[i + 1] === '*') {
      // ** — match any number of path segments (including zero)
      // Consume optional trailing slash: **/ matches zero-or-more dirs
      i += 2;
      if (normalizedPattern[i] === '/') {
        i++;
        // `**/` matches zero or more directory segments
        regexStr += '(?:.+/)?';
      } else {
        // `**` at end matches everything
        regexStr += '.*';
      }
    } else if (ch === '*') {
      // * — match any characters except /
      regexStr += '[^/]*';
      i++;
    } else {
      // Escape regex special characters for literal match
      regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}

/**
 * Signal-based skill discovery watcher.
 *
 * Does NOT use fs.watch — instead provides methods that can be called
 * when file operations happen. The caller handles the event source.
 *
 * Supports:
 * - Re-scanning search paths for newly added skill directories (Requirement 7.1)
 * - Conditional activation based on frontmatter `paths` field (Requirement 7.2)
 *
 * @see Requirements 7.1, 7.2
 */
export class SkillDiscoveryWatcher {
  /** Known skill ids from the last catalog snapshot. */
  private readonly knownIds = new Set<string>();

  constructor(initialCatalog: SkillCatalogEntry[]) {
    for (const entry of initialCatalog) {
      this.knownIds.add(entry.id);
    }
  }

  /**
   * Accept a refreshed catalog and return entries that are new
   * (not previously known).
   *
   * Call this after re-scanning search paths (e.g. via SkillLoader.loadCatalog())
   * when a file-operation signal indicates new skill directories may exist.
   *
   * @param refreshedCatalog - The full catalog from a fresh scan
   * @returns Newly discovered catalog entries not in the previous snapshot
   * @see Requirement 7.1
   */
  refreshCatalog(refreshedCatalog: SkillCatalogEntry[]): SkillCatalogEntry[] {
    const newEntries: SkillCatalogEntry[] = [];

    for (const entry of refreshedCatalog) {
      if (!this.knownIds.has(entry.id)) {
        newEntries.push(entry);
        this.knownIds.add(entry.id);
        getLogger().info(text.skills.newSkillDiscovered(entry.id, entry.location));
      }
    }

    return newEntries;
  }

  /**
   * Check which conditional skills should be activated based on
   * the given file paths.
   *
   * A conditional skill has a `conditionalPaths` array in its catalog entry
   * (from the frontmatter `paths` field). If any of the provided file paths
   * matches any of the skill's conditional patterns, the skill is returned
   * as a candidate for activation.
   *
   * @param filePaths - File paths that were touched (created/edited/deleted)
   * @param catalog - Current skill catalog to check against
   * @returns Catalog entries whose conditional paths match the given files
   * @see Requirement 7.2
   */
  checkConditionalActivation(
    filePaths: string[],
    catalog: SkillCatalogEntry[],
  ): SkillCatalogEntry[] {
    const activated: SkillCatalogEntry[] = [];

    for (const entry of catalog) {
      if (!entry.conditionalPaths || entry.conditionalPaths.length === 0) {
        continue;
      }

      for (const pattern of entry.conditionalPaths) {
        const matched = filePaths.some(fp => matchGlob(fp, pattern));
        if (matched) {
          activated.push(entry);
          getLogger().info(text.skills.conditionalSkillActivated(entry.id, pattern));
          break; // One match is enough to activate this skill
        }
      }
    }

    return activated;
  }
}
