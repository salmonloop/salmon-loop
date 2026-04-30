import { describe, expect, it } from 'bun:test';
import { splitCommand } from '../../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  it('should split basic commands by space', () => {
    expect(splitCommand('npm run dev')).toEqual(['npm', 'run', 'dev']);
  });

  it('should preserve spaces within double quotes', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('should preserve spaces within single quotes', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('should handle escaped characters inside double quotes', () => {
    expect(splitCommand('echo "hello \\"world\\""')).toEqual(['echo', 'hello "world"']);
  });

  it('should handle escaped characters outside quotes', () => {
    expect(splitCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  it('should ignore multiple spaces', () => {
    expect(splitCommand('   npm    run     dev   ')).toEqual(['npm', 'run', 'dev']);
  });
});
