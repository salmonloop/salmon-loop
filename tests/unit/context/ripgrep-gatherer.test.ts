import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { RipgrepGatherer } from '../../../src/core/context/gatherers/ripgrep-gatherer.js';

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  return {
    spawn: vi.fn().mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = vi.fn();
      child.kill = vi.fn();
      return child;
    }),
  };
});

function makeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = vi.fn();
  child.kill = vi.fn();
  return child;
}

describe('RipgrepGatherer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aborts in-flight rg when signal is aborted', async () => {
    const controller = new AbortController();
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const gatherer = new RipgrepGatherer();
    const promise = gatherer.searchMultipleKeywords(['foo'], '/repo', controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrow(/cancelled by user/i);
    expect(child.kill).toHaveBeenCalled();
  });
});
