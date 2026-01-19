import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';

import { ContextBuilder } from '../../src/core/context.js';

vi.mock('fs/promises');
vi.mock('child_process');

describe('ContextBuilder', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should build context with primary file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('console.log("hello");');

    // Mock spawn for git diff and rg
    vi.mocked(spawn).mockImplementation((command: string) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git') {
          // Return empty diff for this test
          emitter.emit('close', 0);
        } else if (command === 'rg') {
          // Return empty search results
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const promise = ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    await vi.runAllTimersAsync();
    const context = await promise;

    expect(context.primaryText).toContain('console.log("hello");');
    expect(context.repoPath).toBe(tempDir);
    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('test.ts'), 'utf-8');
  });

  it('should build context with git diff', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('initial');

    vi.mocked(spawn).mockImplementation((command: string, args: readonly string[]) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      setTimeout(() => {
        if (command === 'git' && args.includes('diff')) {
          emitter.stdout.emit('data', Buffer.from('+modified\n-initial'));
          emitter.emit('close', 0);
        } else {
          emitter.emit('close', 0);
        }
      }, 0);

      return emitter;
    });

    const promise = ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
    });

    await vi.runAllTimersAsync();
    const context = await promise;

    expect(context.gitDiff).toContain('+modified');
  });

  describe('shrinkContext', () => {
    it('should filter rgSnippets based on failed files', async () => {
      const context = {
        repoPath: '.',
        // Make primaryText large enough to exceed minContextChars protection
        primaryText: 'A'.repeat(6000),
        rgSnippets: [
          { file: 'src/a.ts', line: 1, content: 'a' },
          { file: 'src/b.ts', line: 1, content: 'b' },
        ],
      } as any;

      const failedFiles = ['src/a.ts'];
      const newContext = await ContextBuilder.shrinkContext(context, failedFiles);

      expect(newContext.rgSnippets).toHaveLength(1);
      expect(newContext.rgSnippets[0].file).toBe('src/a.ts');
    });
  });
});
