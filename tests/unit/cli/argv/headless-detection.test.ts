import { afterEach, describe, expect, it } from 'bun:test';

import {
  detectHeadlessOutputFromArgv,
  shouldForceColorForArgv,
} from '../../../../src/cli/argv/headless-detection.js';

const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;

function restoreColorEnv() {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = originalForceColor;
}

describe('headless argv detection', () => {
  afterEach(() => {
    restoreColorEnv();
  });

  it('detects JSON output as headless', () => {
    const detected = detectHeadlessOutputFromArgv([
      'bun',
      'src/cli/index.ts',
      'run',
      '-p',
      'hello',
      '--output-format',
      'json',
    ]);

    expect(detected.outputFormat).toBe('json');
    expect(detected.instruction).toBe('hello');
  });

  it('does not force colors for headless JSON or stream JSON output', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    expect(
      shouldForceColorForArgv(['bun', 'src/cli/index.ts', 'run', '--output-format', 'stream-json']),
    ).toBe(false);
    expect(
      shouldForceColorForArgv(['bun', 'src/cli/index.ts', 'run', '--output-format=json']),
    ).toBe(false);
  });

  it('respects NO_COLOR and existing FORCE_COLOR', () => {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = '1';
    expect(shouldForceColorForArgv(['bun', 'src/cli/index.ts', 'chat'])).toBe(false);

    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '0';
    expect(shouldForceColorForArgv(['bun', 'src/cli/index.ts', 'chat'])).toBe(false);
  });

  it('keeps interactive text output color-capable by default', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    expect(shouldForceColorForArgv(['bun', 'src/cli/index.ts', 'chat'])).toBe(true);
    expect(
      shouldForceColorForArgv(['bun', 'src/cli/index.ts', 'run', '--output-format', 'text']),
    ).toBe(true);
  });
});
