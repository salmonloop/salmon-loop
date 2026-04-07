/**
 * Unit tests for SkillDiscoveryWatcher — file-operation signal based
 * dynamic discovery and conditional activation.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * - refreshCatalog() detects newly added skill directories
 * - checkConditionalActivation() matches frontmatter `paths` patterns
 * - Conditional skills stay catalog-only when no files match
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const infoMock = mock();
const warnMock = mock();

mock.module('../../../src/core/observability/logger.js', () => ({
  getLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: mock(),
    debug: mock(),
    audit: mock(),
  }),
}));

import { SkillDiscoveryWatcher, matchGlob } from '../../../src/core/skills/discovery.js';
import type { SkillCatalogEntry } from '../../../src/core/skills/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function catalogEntry(
  id: string,
  conditionalPaths?: string[],
  scope: 'repo' | 'user' | 'config' = 'repo',
): SkillCatalogEntry {
  return {
    id,
    name: id,
    description: `Skill ${id}`,
    location: `/fake/repo/.salmonloop/skills/${id}/SKILL.md`,
    scope,
    conditionalPaths,
  };
}

// ── matchGlob tests ─────────────────────────────────────────────────

describe('matchGlob', () => {
  it('matches exact file path', () => {
    expect(matchGlob('src/index.ts', 'src/index.ts')).toBe(true);
  });

  it('rejects non-matching exact path', () => {
    expect(matchGlob('src/other.ts', 'src/index.ts')).toBe(false);
  });

  it('matches single wildcard within segment', () => {
    expect(matchGlob('src/index.ts', 'src/*.ts')).toBe(true);
    expect(matchGlob('src/utils.ts', 'src/*.ts')).toBe(true);
  });

  it('single wildcard does not cross directory boundaries', () => {
    expect(matchGlob('src/deep/index.ts', 'src/*.ts')).toBe(false);
  });

  it('matches double wildcard across directories', () => {
    expect(matchGlob('src/deep/nested/index.ts', 'src/**/*.ts')).toBe(true);
    expect(matchGlob('src/index.ts', '**/*.ts')).toBe(true);
  });

  it('matches pattern with double wildcard at end', () => {
    expect(matchGlob('src/components/Button.tsx', 'src/**')).toBe(true);
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(matchGlob('src\\deep\\index.ts', 'src/**/*.ts')).toBe(true);
  });
});

// ── refreshCatalog tests ────────────────────────────────────────────

describe('SkillDiscoveryWatcher — refreshCatalog()', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('returns empty array when catalog has not changed', () => {
    const initial = [catalogEntry('skill-a'), catalogEntry('skill-b')];
    const watcher = new SkillDiscoveryWatcher(initial);

    const newEntries = watcher.refreshCatalog(initial);

    expect(newEntries).toEqual([]);
  });

  it('returns newly discovered entries not in initial catalog', () => {
    const initial = [catalogEntry('skill-a')];
    const watcher = new SkillDiscoveryWatcher(initial);

    const refreshed = [catalogEntry('skill-a'), catalogEntry('skill-b')];
    const newEntries = watcher.refreshCatalog(refreshed);

    expect(newEntries.length).toBe(1);
    expect(newEntries[0].id).toBe('skill-b');
  });

  it('logs info for each newly discovered skill', () => {
    const watcher = new SkillDiscoveryWatcher([]);

    watcher.refreshCatalog([catalogEntry('new-skill')]);

    expect(infoMock).toHaveBeenCalled();
    const msg = infoMock.mock.calls[0][0] as string;
    expect(msg).toContain('new-skill');
  });

  it('tracks discovered entries across multiple refreshes', () => {
    const watcher = new SkillDiscoveryWatcher([catalogEntry('skill-a')]);

    // First refresh: skill-b is new
    const first = watcher.refreshCatalog([
      catalogEntry('skill-a'),
      catalogEntry('skill-b'),
    ]);
    expect(first.length).toBe(1);
    expect(first[0].id).toBe('skill-b');

    // Second refresh: skill-b is now known, skill-c is new
    const second = watcher.refreshCatalog([
      catalogEntry('skill-a'),
      catalogEntry('skill-b'),
      catalogEntry('skill-c'),
    ]);
    expect(second.length).toBe(1);
    expect(second[0].id).toBe('skill-c');
  });

  it('returns empty when refreshed catalog is empty', () => {
    const watcher = new SkillDiscoveryWatcher([catalogEntry('skill-a')]);

    const newEntries = watcher.refreshCatalog([]);

    expect(newEntries).toEqual([]);
  });
});

// ── checkConditionalActivation tests ────────────────────────────────

describe('SkillDiscoveryWatcher — checkConditionalActivation()', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('activates skill when file matches conditional path pattern', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [catalogEntry('ts-skill', ['src/**/*.ts'])];

    const activated = watcher.checkConditionalActivation(
      ['src/utils/helper.ts'],
      catalog,
    );

    expect(activated.length).toBe(1);
    expect(activated[0].id).toBe('ts-skill');
  });

  it('does not activate skill when no files match', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [catalogEntry('ts-skill', ['src/**/*.ts'])];

    const activated = watcher.checkConditionalActivation(
      ['docs/readme.md'],
      catalog,
    );

    expect(activated).toEqual([]);
  });

  it('skips skills without conditionalPaths', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [
      catalogEntry('unconditional'),
      catalogEntry('conditional', ['src/**/*.ts']),
    ];

    const activated = watcher.checkConditionalActivation(
      ['src/index.ts'],
      catalog,
    );

    expect(activated.length).toBe(1);
    expect(activated[0].id).toBe('conditional');
  });

  it('skips skills with empty conditionalPaths array', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [catalogEntry('empty-paths', [])];

    const activated = watcher.checkConditionalActivation(
      ['src/index.ts'],
      catalog,
    );

    expect(activated).toEqual([]);
  });

  it('activates skill when any of multiple patterns match', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [catalogEntry('multi-pattern', ['*.py', '*.ts'])];

    const activated = watcher.checkConditionalActivation(
      ['main.py'],
      catalog,
    );

    expect(activated.length).toBe(1);
    expect(activated[0].id).toBe('multi-pattern');
  });

  it('activates multiple skills when their patterns match', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [
      catalogEntry('ts-skill', ['**/*.ts']),
      catalogEntry('css-skill', ['**/*.css']),
    ];

    const activated = watcher.checkConditionalActivation(
      ['src/app.ts', 'styles/main.css'],
      catalog,
    );

    expect(activated.length).toBe(2);
    const ids = activated.map(e => e.id).sort();
    expect(ids).toEqual(['css-skill', 'ts-skill']);
  });

  it('logs info when a conditional skill is activated', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [catalogEntry('logged-skill', ['src/**/*.ts'])];

    watcher.checkConditionalActivation(['src/index.ts'], catalog);

    expect(infoMock).toHaveBeenCalled();
    const msg = infoMock.mock.calls[0][0] as string;
    expect(msg).toContain('logged-skill');
  });

  it('does not duplicate activation for multiple matching files', () => {
    const watcher = new SkillDiscoveryWatcher([]);
    const catalog = [catalogEntry('ts-skill', ['**/*.ts'])];

    const activated = watcher.checkConditionalActivation(
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      catalog,
    );

    // Skill should appear only once even though multiple files match
    expect(activated.length).toBe(1);
    expect(activated[0].id).toBe('ts-skill');
  });
});
