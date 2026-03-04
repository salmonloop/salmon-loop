import { describe, expect, it } from 'bun:test';

import { rewriteArgvForPrintMode } from '../../../../src/cli/argv/print-mode.js';

describe('rewriteArgvForPrintMode', () => {
  it('injects run command for global print mode without explicit command', () => {
    const argv = ['bun', 'src/cli/index.ts', '-p', 'fix lint'];

    expect(rewriteArgvForPrintMode(argv)).toEqual([
      'bun',
      'src/cli/index.ts',
      'run',
      '-p',
      'fix lint',
    ]);
  });

  it('keeps argv when an explicit root command is present', () => {
    const argv = ['bun', 'src/cli/index.ts', 'run', '-p', 'fix lint'];

    expect(rewriteArgvForPrintMode(argv)).toEqual(argv);
  });

  it('keeps argv untouched when print mode is not enabled', () => {
    const argv = ['bun', 'src/cli/index.ts', 'context', '--budget-chars', '2000'];

    expect(rewriteArgvForPrintMode(argv)).toEqual(argv);
  });
});
