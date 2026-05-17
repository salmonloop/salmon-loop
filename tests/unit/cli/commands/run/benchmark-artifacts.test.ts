import { afterEach, describe, expect, it } from 'bun:test';

import { attachRunBenchmarkArtifacts } from '../../../../../src/cli/commands/run/benchmark-artifacts.js';
import type { LoopResult } from '../../../../../src/core/types/loop.js';
import { RealFsTestHelper } from '../../../../helpers/real-fs-helper.js';

describe('run benchmark artifacts', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('writes patch files and SWE-bench predictions before reporters consume LoopResult', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/app.ts', content: 'export const value = 1;\n' },
        { path: 'artifacts/predictions.jsonl', content: '{"old":true}\n' },
      ],
    });
    await helper.writeFile(repo.path, 'src/app.ts', 'export const value = 2;\n');
    await helper.writeFile(repo.path, 'src/new.ts', 'export const created = true;\n');
    await helper.writeFile(repo.path, 'artifacts/predictions.jsonl', '{"old":false}\n');

    const patchPath = `${repo.path}/artifacts/model.patch`;
    const predictionsPath = `${repo.path}/artifacts/predictions.jsonl`;
    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: ['src/app.ts', 'src/new.ts'],
    };

    await attachRunBenchmarkArtifacts({
      result,
      repoPath: repo.path,
      exportPatchPath: patchPath,
      sweBenchInstanceId: 'repo__project-123',
      sweBenchModelName: 'salmon-loop',
      sweBenchPredictionsPath: predictionsPath,
    });

    const patch = String(await helper.readFile(repo.path, 'artifacts/model.patch'));
    const predictionLines = String(await helper.readFile(repo.path, 'artifacts/predictions.jsonl'))
      .trim()
      .split('\n');
    const prediction = JSON.parse(predictionLines.at(-1) ?? '');

    expect(patch).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(patch).toContain('diff --git a/src/new.ts b/src/new.ts');
    expect(patch).not.toContain('artifacts/model.patch');
    expect(patch).not.toContain('artifacts/predictions.jsonl');
    expect(predictionLines[0]).toBe('{"old":false}');
    expect(prediction).toEqual({
      instance_id: 'repo__project-123',
      model_name_or_path: 'salmon-loop',
      model_patch: patch,
    });
    expect(result.benchmarkPatchArtifact).toMatchObject({
      kind: 'git-unified-diff',
      path: patchPath,
      changedFiles: ['src/app.ts', 'src/new.ts'],
      isEmpty: false,
    });
    expect(result.benchmarkArtifact).toEqual({
      provider: 'swe-bench',
      instanceId: 'repo__project-123',
      modelNameOrPath: 'salmon-loop',
      predictionsPath,
    });
  });
});
