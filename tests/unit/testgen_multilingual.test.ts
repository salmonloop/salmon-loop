import mockFs from 'mock-fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { detectProjectType } from '../../src/core/testgen/detector.js';
import { injectSmokeTest } from '../../src/core/testgen.js';

describe('Multilingual Testgen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectProjectType', () => {
    it('should detect nodejs project', () => {
      mockFs({
        '/repo/package.json': '{}',
      });
      expect(detectProjectType('/repo')).toBe('nodejs');
      mockFs.restore();
    });

    it('should detect python project', () => {
      mockFs({
        '/repo/requirements.txt': '',
      });
      expect(detectProjectType('/repo')).toBe('python');
      mockFs.restore();
    });

    it('should detect java maven project', () => {
      mockFs({
        '/repo/pom.xml': '',
      });
      expect(detectProjectType('/repo')).toBe('java_maven');
      mockFs.restore();
    });

    it('should detect go project', () => {
      mockFs({
        '/repo/go.mod': '',
      });
      expect(detectProjectType('/repo')).toBe('go');
      mockFs.restore();
    });
  });

  describe('injectSmokeTest', () => {
    it('should inject python smoke test', async () => {
      mockFs({
        '/repo/requirements.txt': '',
      });
      const result = await injectSmokeTest('/repo');
      expect(result.created).toBe(true);
      expect(result.testCommand).toBe('python salmon_smoke_test.py');
      mockFs.restore();
    });
  });
});
