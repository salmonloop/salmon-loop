import { describe, expect, it } from 'bun:test';

import { splitCommand } from '../../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  it('splits simple commands', () => {
    expect(splitCommand('echo ok')).toEqual(['echo', 'ok']);
  });

  it('handles single quotes', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles double quotes', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('handles mixed quotes', () => {
    expect(splitCommand('echo "hello \'world\'"')).toEqual(['echo', "hello 'world'"]);
  });

  it('handles escaped characters', () => {
    expect(splitCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  it('handles empty strings gracefully', () => {
    expect(splitCommand('')).toEqual([]);
  });
});
