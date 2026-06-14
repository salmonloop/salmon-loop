import { writeFileSync, mkdtempSync } from 'fs';
import { readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  applyOverlayAndCommit,
  buildQualitySummary,
  buildVerifyFromFailToPass,
  buildVerifyGateFromAudit,
  classifyVerifyStrength,
  deriveSmokeKind,
  resolveSmokeExitCode,
  runPatchedShellGates,
  runPreSubmitGate,
} from '../../../scripts/swebench-smoke.ts';
import { RealFsTestHelper } from '../../helpers/real-fs-helper.js';

const tempDirs: string[] = [];
const helper = new RealFsTestHelper();

afterEach(async () => {
  await helper.cleanup();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('SWE-bench smoke harness semantics', () => {
  it('treats trivial verify as flow-only, not behavior verification', () => {
    const gates = {
      overlay: { status: 'skip' as const, code: 'x', message: 'x' },
      reproduction: { status: 'pass' as const, code: 'x', message: 'x' },
      verifyStrength: classifyVerifyStrength('true'),
      patchNonEmpty: { status: 'pass' as const, code: 'x', message: 'x' },
      predictionParse: { status: 'pass' as const, code: 'x', message: 'x' },
      predictionPatch: { status: 'pass' as const, code: 'x', message: 'x' },
      gitDiffCheck: { status: 'pass' as const, code: 'x', message: 'x' },
      gitApplyCheck: { status: 'pass' as const, code: 'x', message: 'x' },
      behavior: { status: 'pass' as const, code: 'x', message: 'x' },
      regression: { status: 'pass' as const, code: 'x', message: 'x' },
      verify: { status: 'skip' as const, code: 'x', message: 'x' },
      submission: { status: 'skip' as const, code: 'x', message: 'x' },
    };

    expect(gates.verifyStrength.status).toBe('fail');
    expect(buildQualitySummary({ flowSuccess: true, gates })).toMatchObject({
      flowSuccess: true,
      reproductionPrepared: true,
      patchApplyable: true,
      behaviorVerified: false,
      regressionVerified: true,
      passedLocalQualityBar: false,
    });
  });

  it('does not treat a missing regression command as PASS_TO_PASS coverage', () => {
    const gates = {
      overlay: { status: 'skip' as const, code: 'x', message: 'x' },
      reproduction: { status: 'pass' as const, code: 'x', message: 'x' },
      verifyStrength: { status: 'pass' as const, code: 'x', message: 'x' },
      patchNonEmpty: { status: 'pass' as const, code: 'x', message: 'x' },
      predictionParse: { status: 'pass' as const, code: 'x', message: 'x' },
      predictionPatch: { status: 'pass' as const, code: 'x', message: 'x' },
      gitDiffCheck: { status: 'pass' as const, code: 'x', message: 'x' },
      gitApplyCheck: { status: 'pass' as const, code: 'x', message: 'x' },
      behavior: { status: 'pass' as const, code: 'x', message: 'x' },
      regression: { status: 'skip' as const, code: 'x', message: 'x' },
      verify: { status: 'skip' as const, code: 'x', message: 'x' },
      submission: { status: 'skip' as const, code: 'x', message: 'x' },
    };

    expect(buildQualitySummary({ flowSuccess: true, gates })).toMatchObject({
      regressionVerified: false,
      passedLocalQualityBar: false,
    });
  });

  it('separates deterministic, real-provider, and benchmark-submit smoke labels', () => {
    expect(
      deriveSmokeKind({
        submit: false,
        warnings: [{ code: 'LLM_CREDENTIAL_MISSING' }],
      }),
    ).toBe('deterministic-contract');
    expect(deriveSmokeKind({ submit: false, warnings: [] })).toBe('real-llm-smoke');
    expect(deriveSmokeKind({ submit: true, warnings: [] })).toBe('benchmark-submit');
  });

  it('requires a resolved submission when benchmark submission is requested', () => {
    const quality = {
      flowSuccess: true,
      reproductionPrepared: true,
      patchApplyable: true,
      behaviorVerified: true,
      regressionVerified: true,
      submitted: false,
      resolved: false,
      passedLocalQualityBar: true,
    };

    expect(resolveSmokeExitCode({ quality, submit: false })).toBe(0);
    expect(resolveSmokeExitCode({ quality, submit: true })).toBe(1);
    expect(
      resolveSmokeExitCode({
        quality: { ...quality, submitted: true, resolved: true },
        submit: true,
      }),
    ).toBe(0);
  });

  it('commits reproduction overlay before agent execution so it is excluded from model patch', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/app.js', content: 'export const value = 1;\n' }],
    });
    const result = await applyOverlayAndCommit({
      repoDir: repo.path,
      timeoutMs: 10_000,
      overlay: {
        files: [{ path: 'tests/repro.test.js', content: 'console.log("repro");\n' }],
      },
    });

    expect(result.status).toBe('pass');
    expect(await readFile(path.join(repo.path, 'tests/repro.test.js'), 'utf-8')).toBe(
      'console.log("repro");\n',
    );

    await helper.writeFile(repo.path, 'src/app.js', 'export const value = 2;\n');
    const diff = await helper.git(repo.path, ['diff', '--name-only', 'HEAD']);
    expect(diff.stdout.split('\n').filter(Boolean)).toEqual(['src/app.js']);
  });

  it('runs behavior checks in the original repoDir so installed dependencies are available', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/app.js', content: 'export const value = 1;\n' }],
    });
    await helper.writeFile(repo.path, 'src/app.js', 'export const value = 2;\n');
    const artifactDir = await helper.createTempDir('salmon-swebench-artifacts-');
    const patchPath = path.join(artifactDir, 'model.patch');
    const exportedPatch = (
      await helper.git(
        repo.path,
        ['diff', '--binary', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD', '--', '.'],
        { trim: false },
      )
    ).stdout;
    await helper.writeFile(artifactDir, 'model.patch', exportedPatch);

    const result = await runPatchedShellGates({
      behaviorCommand: 'test "$(cat src/app.js)" = "export const value = 2;"',
      regressionCommand: 'test "$(cat src/app.js)" = "export const value = 2;"',
      repoDir: repo.path,
      patchPath,
      artifactDir,
      timeoutMs: 10_000,
    });

    expect(result.behavior).toMatchObject({
      status: 'pass',
      code: 'BEHAVIOR_PASSED',
    });
    expect(result.regression).toMatchObject({
      status: 'pass',
      code: 'REGRESSION_PASSED',
    });
  });

  it('requires the submitted SWE-bench model patch to match the exported patch', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/app.js', content: 'export const value = 1;\n' }],
    });
    await helper.writeFile(repo.path, 'src/app.js', 'export const value = 2;\n');
    const artifactDir = await helper.createTempDir('salmon-swebench-artifacts-');
    const patchPath = path.join(artifactDir, 'model.patch');
    const predictionsPath = path.join(artifactDir, 'preds.jsonl');
    const exportedPatch = (
      await helper.git(repo.path, [
        'diff',
        '--binary',
        '--no-color',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'HEAD',
        '--',
        '.',
      ])
    ).stdout;
    await helper.writeFile(artifactDir, 'model.patch', `${exportedPatch}\n`);
    await helper.writeFile(
      artifactDir,
      'preds.jsonl',
      `${JSON.stringify({
        instance_id: 'local__mismatch',
        model_name_or_path: 'salmon-loop',
        model_patch: 'diff --git a/other.js b/other.js\n',
      })}\n`,
    );

    const result = await runPreSubmitGate({
      repoDir: repo.path,
      patchPath,
      predictionsPath,
      artifactDir,
      timeoutMs: 10_000,
    });

    expect(result.gates.predictionParse.status).toBe('pass');
    expect(result.gates.predictionPatch).toMatchObject({
      status: 'fail',
      code: 'PREDICTION_PATCH_MISMATCH',
    });
    expect(
      buildQualitySummary({
        flowSuccess: true,
        gates: {
          overlay: { status: 'skip', code: 'x', message: 'x' },
          reproduction: { status: 'pass', code: 'x', message: 'x' },
          verifyStrength: { status: 'pass', code: 'x', message: 'x' },
          ...result.gates,
          behavior: { status: 'pass', code: 'x', message: 'x' },
          regression: { status: 'pass', code: 'x', message: 'x' },
          verify: { status: 'skip', code: 'x', message: 'x' },
          submission: { status: 'skip', code: 'x', message: 'x' },
        },
      }).patchApplyable,
    ).toBe(false);
  });
});

describe('buildVerifyGateFromAudit', () => {
  function writeAudit(data: unknown): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const auditPath = path.join(dir, 'audit.json');
    writeFileSync(auditPath, JSON.stringify(data));
    tempDirs.push(dir);
    return auditPath;
  }

  it('returns VERIFY_PASSED when audit has verifyResult.ok=true', () => {
    const auditPath = writeAudit({
      context: { verifyResult: { ok: true, exitCode: 0 } },
    });
    const result = buildVerifyGateFromAudit(auditPath, false);
    expect(result.status).toBe('pass');
    expect(result.code).toBe('VERIFY_PASSED');
  });

  it('returns VERIFY_FAILED when audit has verifyResult.ok=false', () => {
    const auditPath = writeAudit({
      context: { verifyResult: { ok: false, output: 'test failed', exitCode: 1 } },
    });
    const result = buildVerifyGateFromAudit(auditPath, false);
    expect(result.status).toBe('fail');
    expect(result.code).toBe('VERIFY_FAILED');
    expect(result.message).toBe('test failed');
  });

  it('infers VERIFY_PASSED from shell.exec calls when flow succeeded', () => {
    const auditPath = writeAudit({
      context: {
        toolCallingAudit: [
          { toolName: 'shell.exec' },
          { toolName: 'shell.exec' },
          { toolName: 'code.patch' },
        ],
      },
    });
    const result = buildVerifyGateFromAudit(auditPath, true);
    expect(result.status).toBe('pass');
    expect(result.code).toBe('VERIFY_PASSED');
    expect(result.message).toContain('2 shell.exec');
  });

  it('returns VERIFY_FAILED when shell.exec calls present but flow failed', () => {
    const auditPath = writeAudit({
      context: {
        toolCallingAudit: [{ toolName: 'shell.exec' }],
      },
    });
    const result = buildVerifyGateFromAudit(auditPath, false);
    expect(result.status).toBe('fail');
    expect(result.code).toBe('VERIFY_FAILED');
  });

  it('returns VERIFY_NOT_RUN when no shell.exec and no verifyResult', () => {
    const auditPath = writeAudit({
      context: { toolCallingAudit: [{ toolName: 'code.patch' }] },
    });
    const result = buildVerifyGateFromAudit(auditPath, true);
    expect(result.status).toBe('skip');
    expect(result.code).toBe('VERIFY_NOT_RUN');
  });

  it('returns VERIFY_AUDIT_UNREADABLE for missing file', () => {
    const result = buildVerifyGateFromAudit('/nonexistent/audit.json', true);
    expect(result.status).toBe('skip');
    expect(result.code).toBe('VERIFY_AUDIT_UNREADABLE');
  });
});

describe('buildVerifyFromFailToPass', () => {
  it('handles standard pytest node IDs', () => {
    const result = buildVerifyFromFailToPass({
      FAIL_TO_PASS: JSON.stringify([
        'sklearn/linear_model/tests/test_ridge.py::test_ridge_classifier_cv_store_cv_values',
      ]),
    } as any);
    expect(result).toBe(
      'pytest sklearn/linear_model/tests/test_ridge.py::test_ridge_classifier_cv_store_cv_values -x --tb=short -q',
    );
  });

  it('handles bare test names with -k', () => {
    const result = buildVerifyFromFailToPass({
      FAIL_TO_PASS: JSON.stringify(['test_issue_11617']),
    } as any);
    expect(result).toBe('pytest -k "test_issue_11617" -x --tb=short -q');
  });

  it('strips parenthetical suffixes from test names', () => {
    const result = buildVerifyFromFailToPass({
      FAIL_TO_PASS: JSON.stringify([
        'test_ascii_validator (auth_tests.test_validators.UsernameValidatorsTests)',
        'test_unicode_validator (auth_tests.test_validators.UsernameValidatorsTests)',
      ]),
    } as any);
    expect(result).toBe(
      'pytest -k "test_ascii_validator or test_unicode_validator" -x --tb=short -q',
    );
  });

  it('filters out descriptive text entries with spaces', () => {
    const result = buildVerifyFromFailToPass({
      FAIL_TO_PASS: JSON.stringify(['test_foo', 'Named URLs should be reversible', 'test_bar']),
    } as any);
    expect(result).toBe('pytest -k "test_foo or test_bar" -x --tb=short -q');
  });

  it('returns undefined for empty or unparseable input', () => {
    expect(buildVerifyFromFailToPass({ FAIL_TO_PASS: '[]' } as any)).toBeUndefined();
    expect(buildVerifyFromFailToPass({ FAIL_TO_PASS: 'not json' } as any)).toBeUndefined();
    expect(buildVerifyFromFailToPass({} as any)).toBeUndefined();
  });
});
