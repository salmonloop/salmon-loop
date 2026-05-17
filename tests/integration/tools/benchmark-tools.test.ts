import { symlink } from 'fs/promises';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  executeBenchmarkReport,
  executeGitApplyCheck,
  executeGitDiffCheck,
  executeSweBenchGetReport,
  executeSweBenchLoadInstance,
  executeSweBenchSubmitPredictions,
  executeSweBenchWritePrediction,
} from '../../../src/core/tools/builtin/benchmark.js';
import type { ToolRuntimeCtx } from '../../../src/core/tools/types.js';
import { RealFsTestHelper } from '../../helpers/real-fs-helper.js';

describe('benchmark and SWE-bench builtin tools', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  async function createChangedRepo() {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/app.ts', content: 'export const value = 1;\n' }],
    });
    await helper.writeFile(repo.path, 'src/app.ts', 'export const value = 2;\n');
    const ctx: ToolRuntimeCtx = {
      repoRoot: repo.path,
      worktreeRoot: repo.path,
      attemptId: 1,
      dryRun: false,
    };
    return { repo, ctx };
  }

  it('checks current workspace patch structure and applyability without mutating files', async () => {
    const { repo, ctx } = await createChangedRepo();
    const beforeStatus = await helper.git(repo.path, ['status', '--short'], { trim: false });

    const diffCheck = await executeGitDiffCheck({}, ctx);
    const applyCheck = await executeGitApplyCheck({}, ctx);

    const afterStatus = await helper.git(repo.path, ['status', '--short'], { trim: false });
    expect(diffCheck).toMatchObject({
      ok: true,
      changedFiles: ['src/app.ts'],
      fileCount: 1,
    });
    expect(applyCheck).toMatchObject({ ok: true, exitCode: 0 });
    expect(afterStatus.stdout).toBe(beforeStatus.stdout);
    expect(await helper.readFile(repo.path, 'src/app.ts')).toBe('export const value = 2;\n');
  });

  it('reports local benchmark patch metadata and encodes SWE-bench prediction JSONL', async () => {
    const { ctx } = await createChangedRepo();

    const report = await executeBenchmarkReport({}, ctx);
    const prediction = await executeSweBenchWritePrediction(
      {
        instanceId: 'repo__project-1',
        modelNameOrPath: 'salmon-loop',
      },
      ctx,
    );

    expect(report.provider).toBe('local');
    expect(report.patch).toMatchObject({
      changedFiles: ['src/app.ts'],
      isEmpty: false,
    });
    expect(report.patch.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(prediction.jsonl)).toEqual(prediction.prediction);
    expect(prediction.prediction).toMatchObject({
      instance_id: 'repo__project-1',
      model_name_or_path: 'salmon-loop',
    });
    expect(prediction.prediction.model_patch).toContain('diff --git a/src/app.ts b/src/app.ts');
  });

  it('loads local SWE-bench inputs and appends predictions inside the repo', async () => {
    const { repo, ctx } = await createChangedRepo();
    await helper.writeFile(
      repo.path,
      'fixtures/instance.json',
      JSON.stringify({
        instance_id: 'repo__project-1',
        repo: 'repo/project',
        base_commit: 'abc123',
        problem_statement: 'fix the bug',
      }),
    );
    await helper.writeFile(
      repo.path,
      'fixtures/report.json',
      JSON.stringify({ resolved: 1, total: 1 }),
    );

    const instance = await executeSweBenchLoadInstance({ file: 'fixtures/instance.json' }, ctx);
    const submit = await executeSweBenchSubmitPredictions(
      {
        instanceId: 'repo__project-1',
        modelNameOrPath: 'salmon-loop',
        predictionsFile: 'artifacts/predictions.jsonl',
      },
      ctx,
    );
    const report = await executeSweBenchGetReport({ file: 'fixtures/report.json' }, ctx);

    const predictions = String(await helper.readFile(repo.path, 'artifacts/predictions.jsonl'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(instance).toMatchObject({
      instance_id: 'repo__project-1',
      repo: 'repo/project',
      base_commit: 'abc123',
    });
    expect(submit).toMatchObject({
      predictionsFile: 'artifacts/predictions.jsonl',
      appended: true,
      prediction: {
        instance_id: 'repo__project-1',
        model_name_or_path: 'salmon-loop',
      },
    });
    expect(predictions).toHaveLength(1);
    expect(predictions[0]).toEqual(submit.prediction);
    expect(report.report).toEqual({ resolved: 1, total: 1 });
  });

  it('rejects local SWE-bench file paths that are not repo-relative', async () => {
    const { ctx } = await createChangedRepo();

    await expect(executeSweBenchLoadInstance({ file: '/tmp/instance.json' }, ctx)).rejects.toThrow(
      'repo-relative',
    );
    await expect(executeSweBenchLoadInstance({ file: '../instance.json' }, ctx)).rejects.toThrow(
      'outside repository',
    );
    await expect(
      executeSweBenchSubmitPredictions(
        {
          instanceId: 'repo__project-1',
          modelNameOrPath: 'salmon-loop',
          predictionsFile: '../predictions.jsonl',
        },
        ctx,
      ),
    ).rejects.toThrow('outside repository');
  });

  it('rejects reserved repository control paths for local SWE-bench files', async () => {
    const { ctx } = await createChangedRepo();

    await expect(executeSweBenchGetReport({ file: '.git/config' }, ctx)).rejects.toThrow(
      'Reserved path prefix',
    );
    await expect(
      executeSweBenchGetReport({ file: 'fixtures/../.git/config' }, ctx),
    ).rejects.toThrow('Reserved path prefix');
    await expect(
      executeSweBenchSubmitPredictions(
        {
          instanceId: 'repo__project-1',
          modelNameOrPath: 'salmon-loop',
          predictionsFile: '.salmonloop/predictions.jsonl',
        },
        ctx,
      ),
    ).rejects.toThrow('Reserved path prefix');
  });

  it('rejects symlink escapes when reading inputs or appending predictions', async () => {
    const { repo, ctx } = await createChangedRepo();
    const outside = await helper.createTempDir('benchmark-outside-');
    await helper.writeFile(outside, 'instance.json', JSON.stringify({ instance_id: 'outside-1' }));
    await symlink(
      path.join(outside, 'instance.json'),
      path.join(repo.path, 'linked-instance.json'),
    );
    await symlink(outside, path.join(repo.path, 'linked-artifacts'), 'junction');

    await expect(
      executeSweBenchLoadInstance({ file: 'linked-instance.json' }, ctx),
    ).rejects.toThrow('symlink');
    await expect(
      executeSweBenchSubmitPredictions(
        {
          instanceId: 'repo__project-1',
          modelNameOrPath: 'salmon-loop',
          predictionsFile: 'linked-artifacts/predictions.jsonl',
        },
        ctx,
      ),
    ).rejects.toThrow('symlink');
    await expect(helper.readFile(outside, 'predictions.jsonl')).rejects.toThrow();
  });
});
