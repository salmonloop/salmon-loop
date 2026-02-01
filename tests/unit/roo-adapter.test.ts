import { runSalmonLoop } from '../../src/index.js';
import { RooSalmonAdapter } from '../../src/integrations/roo/adapter.js';

vi.mock('../../src/index.js', () => ({
  runSalmonLoop: vi.fn(),
}));

vi.mock('../../src/core/logger.js', () => ({
  Logger: class {
    setVerbose = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
    trace = vi.fn();
  },
}));

describe('RooSalmonAdapter', () => {
  let adapter: RooSalmonAdapter;

  beforeEach(() => {
    adapter = new RooSalmonAdapter();
    vi.clearAllMocks();
  });

  it('should call runSalmonLoop with correct options', async () => {
    const options = {
      instruction: 'test',
      verify: 'npm test',
      repoPath: '/repo',
      llm: {} as any,
    };
    vi.mocked(runSalmonLoop).mockResolvedValue({ success: true } as any);

    await adapter.execute(options);

    expect(runSalmonLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: 'test',
        verify: 'npm test',
        repoPath: '/repo',
      }),
    );
  });

  it('should pipe events to onEvent handler', async () => {
    const onEvent = vi.fn();
    vi.mocked(runSalmonLoop).mockImplementation(async (opts: any) => {
      opts.onEvent({ type: 'log', level: 'info', message: 'test log' });
      return { success: true } as any;
    });

    await adapter.execute({ instruction: 'test' } as any, onEvent);

    expect(onEvent).toHaveBeenCalledWith({ type: 'log', level: 'info', message: 'test log' });
  });

  it('should handle different event types in logEvent', async () => {
    // This test implicitly covers logEvent through the onEvent callback in execute
    vi.mocked(runSalmonLoop).mockImplementation(async (opts: any) => {
      opts.onEvent({ type: 'phase.start', phase: 'PLAN' });
      opts.onEvent({ type: 'phase.end', phase: 'PLAN', success: true });
      opts.onEvent({ type: 'diff.meta', changedFiles: ['file1.ts'] });
      opts.onEvent({ type: 'retry', fromAttempt: 1, toAttempt: 2, reason: 'fail' });
      opts.onEvent({ type: 'log', level: 'error', message: 'err' });
      opts.onEvent({ type: 'log', level: 'warn', message: 'wrn' });
      opts.onEvent({ type: 'log', level: 'debug', message: 'dbg' });
      opts.onEvent({ type: 'log', level: 'trace', message: 'trc' });
      return { success: true } as any;
    });

    await adapter.execute({ instruction: 'test', verbose: 'extended' } as any);
    // If no error occurs, it means logEvent handled all types
  });
});
