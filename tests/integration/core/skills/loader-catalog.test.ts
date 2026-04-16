import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../../src/core/skills/loader.js';

describe('SkillLoader.loadCatalog()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-loader-catalog-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads only canonical SKILL.md entries from skill directories', async () => {
    const skillsRoot = path.join(tempDir, '.salmonloop', 'skills');
    const skillDir = path.join(skillsRoot, 'strict-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: strict-skill\ndescription: "Strict"\n---\nBody',
      'utf-8',
    );

    // Direct markdown file should be ignored in strict mode.
    fs.writeFileSync(path.join(skillsRoot, 'legacy.md'), '# legacy', 'utf-8');

    const loader = new SkillLoader({ repoRoot: tempDir });
    const catalog = await loader.loadCatalog();

    expect(catalog.length).toBe(1);
    expect(catalog[0].id).toBe('strict-skill');
  });
});
