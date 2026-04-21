import { describe, it, expect } from 'bun:test';

import { splitCommand } from '../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  it('splits simple commands', () => {
    expect(splitCommand('ls -la')).toEqual(['ls', '-la']);
  });

  it('handles multiple spaces', () => {
    expect(splitCommand('ls   -la   /dir')).toEqual(['ls', '-la', '/dir']);
  });

  it('handles double quotes', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('handles single quotes', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles escaped characters', () => {
    expect(splitCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  it('handles escaped quotes', () => {
    expect(splitCommand('echo "hello \\"world\\""')).toEqual(['echo', 'hello "world"']);
  });
});
