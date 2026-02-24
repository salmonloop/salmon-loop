import { RipgrepGatherer } from '../../../src/core/context/gatherers/ripgrep-gatherer.js';
import { spawnCommand } from '../../../src/core/runtime/process-runner.js';

vi.mock('../../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: vi.fn(),
}));

describe('RipgrepGatherer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (spawnCommand as any).mockResolvedValue({
      code: 0,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it('aborts in-flight rg when signal is aborted', async () => {
    const controller = new AbortController();
    (spawnCommand as any).mockImplementation(async (input: any) => {
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });
      return {
        code: null,
        signal: 'SIGTERM',
        timedOut: false,
        aborted: true,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    const gatherer = new RipgrepGatherer();
    const promise = gatherer.searchMultipleKeywords(['foo'], '/repo', controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrow(/cancelled by user/i);
    expect(spawnCommand).toHaveBeenCalledTimes(1);
  });
});
