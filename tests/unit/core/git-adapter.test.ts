import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { runGitCommand } from '../../../src/core/adapters/git/git-runner.js';

vi.mock('../../../src/core/adapters/git/git-runner.js', () => ({
  runGitCommand: vi.fn(),
}));

describe('GitAdapter exec truncation handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when stdout is truncated', async () => {
    vi.mocked(runGitCommand).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('abc', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: true,
      stderrTruncated: false,
    });

    const git = new GitAdapter('/repo');

    await expect(
      git.exec(['status'], { limits: { maxStdoutBytes: 1, maxStderrChars: 100 } }),
    ).rejects.toThrow(/truncated/i);
  });

  it('execMeta returns truncation metadata without throwing', async () => {
    vi.mocked(runGitCommand).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('abc', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: true,
      stderrTruncated: false,
    });

    const git = new GitAdapter('/repo');
    const res = await git.execMeta(['status'], {
      limits: { maxStdoutBytes: 1, maxStderrChars: 1 },
    });

    expect(res.ok).toBe(true);
    expect(res.stdoutTruncated).toBe(true);
  });
});
