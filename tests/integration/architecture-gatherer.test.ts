import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { describe, test, expect, beforeEach } from 'bun:test';

import { ArchitectureGatherer } from '../../src/core/context/gatherers/architecture-gatherer.js';
import { ContextRequest } from '../../src/core/context/types.js';

describe('ArchitectureGatherer', () => {
  const testRepo = path.join(process.cwd(), 'tests/tmp/architecture-test');
  const mockReq: ContextRequest = {
    repoPath: testRepo,
    instruction: 'analyze architecture',
  };

  beforeEach(async () => {
    // Setup a mock repository structure
    await rm(testRepo, { recursive: true, force: true });
    await mkdir(path.join(testRepo, 'src/core/context'), { recursive: true });
    await mkdir(path.join(testRepo, 'src/cli/commands'), { recursive: true });
    await mkdir(path.join(testRepo, 'src/utils'), { recursive: true });
    await mkdir(path.join(testRepo, 'src/adapters'), { recursive: true });

    await writeFile(path.join(testRepo, 'package.json'), JSON.stringify({ name: 'test-project' }));
    await writeFile(path.join(testRepo, 'src/index.ts'), '// entry point');
  });

  test('should scan src/ and identify core modules', async () => {
    const gatherer = new ArchitectureGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.modules).toBeDefined();
    // Verify core module identification
    const coreModule = result.modules.find((m) => m.name === 'core');
    expect(coreModule).toBeDefined();
    expect(coreModule?.estimatedRole).toBe('core');

    // Verify cli module identification
    const cliModule = result.modules.find((m) => m.name === 'cli');
    expect(cliModule).toBeDefined();
    expect(cliModule?.estimatedRole).toBe('cli');
  });

  test('should generate a brief folder structure string', async () => {
    const gatherer = new ArchitectureGatherer();
    const result = await gatherer.gather(mockReq);

    expect(result.folderStructure).toBeDefined();
    expect(result.folderStructure).toContain('src/');
    expect(result.folderStructure).toContain('core/');
    expect(result.folderStructure).toContain('cli/');
  });
});
