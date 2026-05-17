import { FileAdapter } from '../../../core/adapters/fs/file-adapter.js';
import { buildBenchmarkPatchArtifact } from '../../../core/benchmark/patch-artifact.js';
import { encodeSweBenchPredictionJsonl } from '../../../core/benchmark/swe-bench.js';
import type { LoopResult } from '../../../core/types/loop.js';

export async function attachRunBenchmarkArtifacts(params: {
  result: LoopResult;
  repoPath: string;
  exportPatchPath?: string;
  sweBenchInstanceId?: string;
  sweBenchModelName?: string;
  sweBenchPredictionsPath?: string;
}): Promise<void> {
  if (!params.exportPatchPath && !params.sweBenchPredictionsPath) return;

  const fileAdapter = new FileAdapter();
  const artifact = await buildBenchmarkPatchArtifact({
    repoPath: params.repoPath,
    changedFilesHint: params.result.changedFiles,
    excludePaths: [params.exportPatchPath, params.sweBenchPredictionsPath].filter(
      (path): path is string => typeof path === 'string',
    ),
  });

  if (params.exportPatchPath) {
    await fileAdapter.writeFile(params.exportPatchPath, artifact.patch);
  }

  params.result.benchmarkPatchArtifact = {
    kind: 'git-unified-diff',
    path: params.exportPatchPath,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    changedFiles: artifact.changedFiles,
    isEmpty: artifact.isEmpty,
  };

  if (params.sweBenchPredictionsPath) {
    if (!params.sweBenchInstanceId || !params.sweBenchModelName) {
      throw new Error('SWE-bench predictions require instance id and model name.');
    }
    await fileAdapter.appendFile(
      params.sweBenchPredictionsPath,
      encodeSweBenchPredictionJsonl({
        instanceId: params.sweBenchInstanceId,
        modelNameOrPath: params.sweBenchModelName,
        modelPatch: artifact.patch,
      }),
    );
    params.result.benchmarkArtifact = {
      provider: 'swe-bench',
      instanceId: params.sweBenchInstanceId,
      modelNameOrPath: params.sweBenchModelName,
      predictionsPath: params.sweBenchPredictionsPath,
    };
  }
}
