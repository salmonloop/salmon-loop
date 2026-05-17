import { describe, expect, it } from 'bun:test';

import {
  buildSweBenchPrediction,
  encodeSweBenchPredictionJsonl,
  parseSweBenchInstance,
} from '../../../../src/core/benchmark/swe-bench.js';

describe('SWE-bench prediction encoding', () => {
  it('encodes the official prediction fields as JSONL', () => {
    const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
    const prediction = buildSweBenchPrediction({
      instanceId: 'repo__project-1',
      modelNameOrPath: 'salmon-loop',
      modelPatch: patch,
    });

    expect(prediction).toEqual({
      instance_id: 'repo__project-1',
      model_name_or_path: 'salmon-loop',
      model_patch: patch,
    });

    const line = encodeSweBenchPredictionJsonl({
      instanceId: 'repo__project-1',
      modelNameOrPath: 'salmon-loop',
      modelPatch: patch,
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual(prediction);
  });

  it('loads a local SWE-bench instance object with required identity', () => {
    const instance = parseSweBenchInstance(
      JSON.stringify({
        instance_id: 'repo__project-1',
        repo: 'repo/project',
        base_commit: 'abc123',
        problem_statement: 'fix the bug',
      }),
    );

    expect(instance).toMatchObject({
      instance_id: 'repo__project-1',
      repo: 'repo/project',
      base_commit: 'abc123',
      problem_statement: 'fix the bug',
    });
  });

  it('rejects malformed local SWE-bench instances', () => {
    expect(() => parseSweBenchInstance('{}')).toThrow('instance_id');
    expect(() => parseSweBenchInstance('[]')).toThrow('JSON object');
  });
});
