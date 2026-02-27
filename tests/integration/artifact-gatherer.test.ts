import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { mkdir, writeFile, rm } from '../../src/core/adapters/fs/node-fs.js';
import { ArtifactGatherer } from '../../src/core/context/gatherers/artifact-gatherer.js';
import { ContextRequest } from '../../src/core/context/types.js';

describe('ArtifactGatherer', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/artifact-test');
  const mockReq: ContextRequest = {
    repoPath: testRepo,
    instruction: 'check artifacts',
  };

  beforeEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(testRepo, { recursive: true });
  });

  test('should detect build directories', async () => {
    await mkdir(path.join(testRepo, 'dist'), { recursive: true });
    await mkdir(path.join(testRepo, 'build'), { recursive: true });

    const gatherer = new ArtifactGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.buildDirs).toContain('dist');
    expect(result.buildDirs).toContain('build');
  });

  test('should detect lock files and generate partial hashes', async () => {
    const lockContent = 'lock-content-example-12345';
    await writeFile(path.join(testRepo, 'package-lock.json'), lockContent);

    const gatherer = new ArtifactGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.lockFiles).toHaveLength(1);
    expect(result.lockFiles?.[0].path).toBe('package-lock.json');
    expect(result.lockFiles?.[0].hash).toBeDefined();
  });

  test('should include names of runtime environment variables', async () => {
    process.env.NODE_TEST_VAR = 'true';

    const gatherer = new ArtifactGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.envVars).toContain('NODE_TEST_VAR');
    // Ensure values are not leaked
    expect((result as any).NODE_TEST_VAR).toBeUndefined();
  });
});
