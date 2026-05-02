import { describe, expect, it } from 'bun:test';

import { splitCommand } from '../../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  it('splits simple commands by space', () => {
    expect(splitCommand('echo hello world')).toEqual(['echo', 'hello', 'world']);
  });

  it('handles single quotes', () => {
    expect(splitCommand("my-script --path '/some/path with spaces/'")).toEqual([
      'my-script',
      '--path',
      '/some/path with spaces/',
    ]);
  });

  it('handles double quotes', () => {
    expect(splitCommand('echo "hello world" test')).toEqual(['echo', 'hello world', 'test']);
  });

  it('handles escaped quotes', () => {
    expect(splitCommand('curl -X POST \\"http://example.com\\"')).toEqual([
      'curl',
      '-X',
      'POST',
      '"http://example.com"',
    ]);
  });

  it('ignores trailing spaces', () => {
    expect(splitCommand('echo hello   ')).toEqual(['echo', 'hello']);
  });

  it('handles empty string', () => {
    expect(splitCommand('')).toEqual([]);
  });
});
