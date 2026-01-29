import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { detectProjectType } from '../../src/core/testgen/detector.js';
import { injectSmokeTest } from '../../src/core/testgen.js';

describe('Multilingual Testgen', () => {
  let tempRepo: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-testgen-'));
  });

  afterEach(async () => {
    if (tempRepo) {
      await fs.rm(tempRepo, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('detectProjectType', () => {
    it('should detect nodejs project', async () => {
      await fs.writeFile(path.join(tempRepo, 'package.json'), '{}');
      expect(detectProjectType(tempRepo)).toBe('nodejs');
    });

    it('should detect python project', async () => {
      await fs.writeFile(path.join(tempRepo, 'requirements.txt'), '');
      expect(detectProjectType(tempRepo)).toBe('python');
    });

    it('should detect java maven project', async () => {
      await fs.writeFile(path.join(tempRepo, 'pom.xml'), '');
      expect(detectProjectType(tempRepo)).toBe('java_maven');
    });

    it('should detect go project', async () => {
      await fs.writeFile(path.join(tempRepo, 'go.mod'), '');
      expect(detectProjectType(tempRepo)).toBe('go');
    });
  });

  describe('injectSmokeTest', () => {
    it('should inject python smoke test', async () => {
      await fs.writeFile(path.join(tempRepo, 'requirements.txt'), '');
      const result = await injectSmokeTest(tempRepo);
      expect(result.created).toBe(true);
      expect(result.testCommand).toBe('python salmon_smoke_test.py');
    });
  });
});
