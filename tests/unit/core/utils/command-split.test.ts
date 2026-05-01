import { describe, expect, it } from 'bun:test';

import { splitCommand } from '../../../../src/core/utils/command-split.js';

describe('splitCommand', () => {
  it('should split basic commands', () => {
    expect(splitCommand('npm run build')).toEqual(['npm', 'run', 'build']);
  });

  it('should handle single quotes', () => {
    expect(splitCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('should handle double quotes', () => {
    expect(splitCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('should handle escaped spaces', () => {
    expect(splitCommand('cd my\\ project')).toEqual(['cd', 'my project']);
  });

  it('should handle mixed quotes and escapes', () => {
    expect(splitCommand('cmd --flag "val\\"ue" \'single\'')).toEqual([
      'cmd',
      '--flag',
      'val"ue',
      'single',
    ]);
  });

  it('should handle extra whitespace', () => {
    expect(splitCommand('   npm    install   ')).toEqual(['npm', 'install']);
  });
});
