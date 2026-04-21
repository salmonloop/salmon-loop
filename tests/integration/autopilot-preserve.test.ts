import { afterEach, describe, expect, it } from 'bun:test';

import { runAutopilotVerifyGate } from '../../src/core/grizzco/steps/autopilot.js';
import { ArtifactStore } from '../../src/core/sub-agent/artifacts/store.js';
import { buildBunCommand } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('autopilot direct preserve integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('preserves direct workspace mutations after failing verification and stores the output artifact', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/index.ts', content: 'console.log("hello");\n' }],
    });
    const repoPath = repo.path;

    await helper.writeFile(repoPath, 'src/index.ts', 'console.log("autopilot kept this");\n');
    await helper.writeFile(
      repoPath,
      'verify.ts',
      'console.error("autopilot verify failed");\nprocess.exit(1);\n',
    );

    const result = await runAutopilotVerifyGate({
      mutated: true,
      mode: 'autopilot',
      options: {
        verify: buildBunCommand('verify.ts'),
        signal: undefined,
      },
      workspace: {
        baseRepoPath: repoPath,
        workPath: repoPath,
        strategy: 'direct',
      },
      emit: () => {},
    } as any);

    expect(result.verifyResult).toEqual(
      expect.objectContaining({
        ok: false,
        exitCode: 1,
      }),
    );
    expect(result.verifyResult?.output).toContain('autopilot verify failed');

    const content = await helper.readFile(repoPath, 'src/index.ts');
    expect(content).toBe('console.log("autopilot kept this");\n');

    expect(result.verifyArtifact).toBeDefined();
    const storedArtifact = await ArtifactStore.readText(result.verifyArtifact!.handle);
    expect(storedArtifact.ok).toBe(true);
    if (!storedArtifact.ok) {
      throw new Error('expected verify artifact to be readable');
    }
    expect(storedArtifact.content).toContain('autopilot verify failed');
  });
});
