import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'bun:test';

import {
  extractFilePathsFromText,
  buildInstructionWithHints,
} from '../../../scripts/swebench-smoke.js';

describe('SWE-bench smoke harness contract', () => {
  it('keeps the SWE-bench smoke runner available as a package script', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['smoke:swebench']).toBe('bun scripts/swebench-smoke.ts');
  });

  it('documents the layered quality outcomes instead of treating flow success as quality', async () => {
    const docs = await readFile(path.join(process.cwd(), 'docs/reference/headless.md'), 'utf-8');

    expect(docs).toContain('SWE-bench Smoke Harness');
    expect(docs).toContain('flowSuccess');
    expect(docs).toContain('reproductionPrepared');
    expect(docs).toContain('patchApplyable');
    expect(docs).toContain('behaviorVerified');
    expect(docs).toContain('regressionVerified');
    expect(docs).toContain('WEAK_VERIFY_COMMAND');
  });

  it('keeps the smoke runner CLI surface limited to active benchmark inputs', async () => {
    const script = await readFile(path.join(process.cwd(), 'scripts/swebench-smoke.ts'), 'utf-8');

    expect(script).toContain('--source-repo');
    expect(script).toContain('--cleanup');
    expect(script).not.toContain("token === '--repo'");
    expect(script).not.toContain("token === '--base-commit'");
    expect(script).not.toContain('--keep');
  });

  it('documents durable report artifacts by default', async () => {
    const docs = await readFile(path.join(process.cwd(), 'docs/reference/headless.md'), 'utf-8');

    expect(docs).toContain('keeps its output directory by default');
    expect(docs).toContain('--cleanup');
    expect(docs).not.toContain('--keep');
  });
});

describe('extractFilePathsFromText', () => {
  it('should extract backtick-quoted file paths', () => {
    const text = 'In `django/db/models/query.py`, the `filter()` method...';
    const paths = extractFilePathsFromText(text);
    expect(paths).toContain('django/db/models/query.py');
  });

  it('should extract unquoted file paths with directory separators', () => {
    const text = 'The bug is in src/core/utils/helper.ts and lib/parser.go';
    const paths = extractFilePathsFromText(text);
    expect(paths).toContain('src/core/utils/helper.ts');
    expect(paths).toContain('lib/parser.go');
  });

  it('should not extract URLs', () => {
    const text = 'See https://github.com/user/repo/blob/main/file.py for details';
    const paths = extractFilePathsFromText(text);
    expect(paths).not.toContain('https://github.com/user/repo/blob/main/file.py');
  });

  it('should not extract version strings', () => {
    const text = 'Requires Python 3.10.0 or later';
    const paths = extractFilePathsFromText(text);
    expect(paths).toHaveLength(0);
  });

  it('should handle line number references', () => {
    const text = 'Error at `tests/test_foo.py:42` in test_bar';
    const paths = extractFilePathsFromText(text);
    expect(paths).toContain('tests/test_foo.py');
  });

  it('should deduplicate paths', () => {
    const text = 'File `foo/bar.py` and also foo/bar.py are the same';
    const paths = extractFilePathsFromText(text);
    expect(paths.filter((p) => p === 'foo/bar.py')).toHaveLength(1);
  });

  it('should return empty for text with no file paths', () => {
    const text = 'This is just a plain text with no file references.';
    expect(extractFilePathsFromText(text)).toHaveLength(0);
  });
});

describe('buildInstructionWithHints', () => {
  it('should prepend file hints to the instruction', () => {
    const statement = 'In `django/db/models/query.py`, the filter method is broken.';
    const result = buildInstructionWithHints(statement);
    expect(result).toContain('Files mentioned in the problem statement');
    expect(result).toContain('django/db/models/query.py');
    expect(result).toContain(statement);
  });

  it('should return original instruction if no files found', () => {
    const statement = 'Fix the general performance issue.';
    const result = buildInstructionWithHints(statement);
    expect(result).toBe(statement);
  });

  it('should cap at 10 files', () => {
    const files = Array.from({ length: 15 }, (_, i) => `src/module_${i}/file.py`);
    const statement = `Files: ${files.map((f) => '`' + f + '`').join(', ')}`;
    const result = buildInstructionWithHints(statement);
    // Count the hint lines (lines starting with "- ")
    const hintLines = result.split('\n').filter((l) => l.startsWith('- '));
    expect(hintLines).toHaveLength(10);
  });
});
