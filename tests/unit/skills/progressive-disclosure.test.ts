import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../src/core/skills/loader.js';

describe('progressive disclosure', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'progressive-disclosure-'));
    const skillDir = path.join(repoRoot, '.salmonloop', 'skills', 'pd-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: pd-skill\ndescription: "PD"\n---\n!echo pd',
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('loads catalog first and full skill on activation', async () => {
    const loader = new SkillLoader({ repoRoot });

    const catalog = await loader.loadCatalog();
    expect(catalog[0]).toEqual({
      id: 'pd-skill',
      name: 'pd-skill',
      description: 'PD',
      location: path.join(repoRoot, '.salmonloop', 'skills', 'pd-skill', 'SKILL.md'),
      scope: 'repo',
    });

    const full = await loader.activateSkill('pd-skill');
    expect(full.instructions).toContain('!echo pd');
  });
});
