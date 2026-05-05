import { describe, expect, test } from 'bun:test';

import { splitCommand } from '../../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  test('handles empty command', () => {
    expect(splitCommand('')).toEqual({ cmd: '', args: [] });
    expect(splitCommand('   ')).toEqual({ cmd: '', args: [] });
  });

  test('splits simple command with arguments', () => {
    expect(splitCommand('ls -la')).toEqual({ cmd: 'ls', args: ['-la'] });
  });

  test('respects double quotes', () => {
    expect(splitCommand('echo "hello world"')).toEqual({ cmd: 'echo', args: ['hello world'] });
  });

  test('respects single quotes', () => {
    expect(splitCommand("echo 'hello world'")).toEqual({ cmd: 'echo', args: ['hello world'] });
  });
});
