import * as fs from 'node:fs/promises';

import { describe, expect, it, mock, beforeEach } from 'bun:test';

import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';

describe('GitAdapter 3-way merge fallback', () => {
  let execSpy: any;

  beforeEach(() => {
    mock.restore();
    execSpy = mock();
  });

  it('keeps index lines for binary patches even if 3-way is impossible', async () => {
    const git = new GitAdapter('/repo');

    // Mock execRaw for cat-file and exec for apply
    git.execRaw = async (args: string[]) => {
      if (args[0] === 'cat-file') {
        return {
          ok: false,
          code: 1,
          stdout: Buffer.from(''),
          stderr: 'not found',
          signal: null,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }
      return {
        ok: true,
        code: 0,
        stdout: Buffer.from(''),
        stderr: '',
        signal: null,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    };

    let writtenFileContent = '';
    git.exec = async (args: string[]) => {
      execSpy(args);
      // Read the file content passed to apply
      if (args.includes('apply')) {
        const fileArg = args[args.length - 1];
        writtenFileContent = await fs.readFile(fileArg, 'utf8');
      }
      // Return empty instead of actually running the git command since we're not in a real repo
      return '';
    };

    const diffText = `
GIT binary patch
literal 10
zc$xyz

index 1234567..89abcdef
`;

    // Apply patch with threeWay: true
    await git.applyPatch(diffText, { threeWay: true });

    // Check that 'apply' was called without '-3' since blob is missing
    expect(execSpy).toHaveBeenCalled();
    const args = execSpy.mock.calls[0][0];

    expect(args).toContain('apply');
    expect(args).not.toContain('-3');

    // Check that the file passed to apply contains the index line
    expect(writtenFileContent).toContain('index 1234567..89abcdef');
  });
});
