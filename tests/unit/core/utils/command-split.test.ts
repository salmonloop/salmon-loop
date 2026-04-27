import { describe, expect, test } from 'bun:test';

import { splitCommand } from '../../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  test('splits simple command', () => {
    expect(splitCommand('echo hello')).toEqual(['echo', 'hello']);
  });

  test('handles double quotes', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  test('handles single quotes', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  test('handles mixed quotes', () => {
    expect(splitCommand('echo "hello \'world\'"')).toEqual(['echo', "hello 'world'"]);
  });
});
