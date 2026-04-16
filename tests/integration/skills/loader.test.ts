import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../src/core/skills/loader.js';

describe('SkillLoader', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-loader-'));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('ignores direct markdown files under skills root', async () => {
    const skillsRoot = path.join(repoRoot, '.salmonloop', 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.writeFileSync(path.join(skillsRoot, 'legacy.md'), '# legacy', 'utf-8');

    const loader = new SkillLoader({ repoRoot });
    expect(await loader.loadCatalog()).toEqual([]);
  });

  it('loads and activates canonical SKILL.md entries', async () => {
    const skillDir = path.join(repoRoot, '.salmonloop', 'skills', 'hello-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: hello-skill\ndescription: "Hello"\n---\n!echo hello',
      'utf-8',
    );

    const loader = new SkillLoader({ repoRoot });
    const catalog = await loader.loadCatalog();
    const skill = await loader.activateSkill('hello-skill');

    expect(catalog.map((c) => c.id)).toEqual(['hello-skill']);
    expect(skill.id).toBe('hello-skill');
  });

  it('prefers extra paths over repo defaults', async () => {
    const extraRoot = path.join(repoRoot, 'custom-skills');
    const extraSkill = path.join(extraRoot, 'dup-skill');
    const repoSkill = path.join(repoRoot, '.salmonloop', 'skills', 'dup-skill');

    fs.mkdirSync(extraSkill, { recursive: true });
    fs.writeFileSync(
      path.join(extraSkill, 'SKILL.md'),
      '---\nname: dup-skill\ndescription: "from-extra"\n---\nextra',
      'utf-8',
    );

    fs.mkdirSync(repoSkill, { recursive: true });
    fs.writeFileSync(
      path.join(repoSkill, 'SKILL.md'),
      '---\nname: dup-skill\ndescription: "from-repo"\n---\nrepo',
      'utf-8',
    );

    const loader = new SkillLoader({ repoRoot, extraPaths: [extraRoot] });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);
    expect(catalog[0].description).toBe('from-extra');
  });
});
