import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../src/core/skills/loader.js';

describe('skills discovery integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-discovery-int-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers skills from canonical directory layout', async () => {
    const skillDir = path.join(tempDir, '.salmonloop', 'skills', 'demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: "Demo"\n---\nRun demo',
      'utf-8',
    );

    const loader = new SkillLoader({ repoRoot: tempDir });
    const catalog = await loader.loadCatalog();
    const full = await loader.activateSkill('demo-skill');

    expect(catalog.map((s) => s.id)).toEqual(['demo-skill']);
    expect(full.metadata.name).toBe('demo-skill');
    expect(full.instructions).toContain('Run demo');
  });
});
