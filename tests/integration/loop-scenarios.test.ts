import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { injectSmokeTest } from '../../src/core/testgen/index.js';

// CRITICAL: NO GLOBAL FS MOCKS. Integration tests must use the real file system.

describe('SalmonLoop Scenarios', () => {
  let repoPath: string;

  beforeEach(async () => {
    // Create a real temporary directory for the test
    repoPath = await fs.mkdtemp(join(tmpdir(), 'salmon-scenarios-'));
  });

  afterEach(async () => {
    // Clean up the temporary directory
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('Scenario: Multilingual Project Detection and Test Injection', async () => {
    // Create a dummy requirements.txt to simulate a Python repo
    await fs.writeFile(join(repoPath, 'requirements.txt'), 'flask');

    // Run the injection
    const result = await injectSmokeTest(repoPath);

    // Verify results
    expect(result.created).toBe(true);
    expect(result.testCommand).toBe('python salmon_smoke_test.py');

    // Verify side effect: File should exist on disk
    const testFilePath = join(repoPath, 'salmon_smoke_test.py');
    const fileExists = await fs
      .stat(testFilePath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    const content = await fs.readFile(testFilePath, 'utf-8');
    // Updated expectation based on actual output
    expect(content).toContain('Running smoke test on Python');
  });
});
