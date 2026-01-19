import { ContextBuilder } from '../../src/core/context.js';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('fs/promises');
vi.mock('child_process');

describe('ContextBuilder', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.clearAllMocks();
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

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

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

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
    });

    expect(context.gitDiff).toContain('+modified');
  });
});
