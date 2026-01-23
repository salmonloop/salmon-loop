import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AstParser } from '../../src/core/ast/parser.js';
import { ContextBuilder } from '../../src/core/context.js';

vi.mock('fs/promises');
vi.mock('child_process');
vi.mock('../../src/core/ast/parser.js', () => ({
  AstParser: class {
    static parse = vi.fn();
    static identifyDefinitions = vi.fn();
    static identifyReferences = vi.fn();
  },
}));

describe('ContextBuilder', () => {
  const tempDir = '/fake/temp/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default AST mocks
    vi.mocked(AstParser.parse).mockResolvedValue({} as any);
    vi.mocked(AstParser.identifyDefinitions).mockResolvedValue([]);
    vi.mocked(AstParser.identifyReferences).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should build context with primary file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('console.log("hello");');

    // ✅ Mock spawn with synchronous event emission (no process.nextTick)
    vi.mocked(spawn).mockImplementation((_command: string) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = new EventEmitter();
      emitter.stdin.end = vi.fn();
      emitter.stdin.write = vi.fn();
      emitter.kill = vi.fn();

      // ✅ Use queueMicrotask instead of process.nextTick (controlled by test environment)
      queueMicrotask(() => {
        emitter.emit('close', 0);
        emitter.emit('exit', 0);
      });

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

  it('should include AST symbols in context', async () => {
    const code = 'function test() { console.log("hello"); }';
    vi.mocked(fs.readFile).mockResolvedValue(code);
    vi.mocked(AstParser.parse).mockResolvedValue({} as any);
    vi.mocked(AstParser.identifyDefinitions).mockResolvedValue([
      {
        name: 'test',
        kind: 'definition',
        location: { start: { line: 1, column: 9 }, end: { line: 1, column: 13 } },
      },
    ]);
    vi.mocked(AstParser.identifyReferences).mockResolvedValue([]);

    // ✅ Mock spawn with queueMicrotask (no process.nextTick)
    vi.mocked(spawn).mockImplementation(() => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = new EventEmitter();
      emitter.stdin.end = vi.fn();
      emitter.stdin.write = vi.fn();
      emitter.kill = vi.fn();

      // ✅ Use queueMicrotask for deterministic async behavior
      queueMicrotask(() => {
        emitter.emit('close', 0);
        emitter.emit('exit', 0);
      });

      return emitter;
    });

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    expect(context.symbols).toBeDefined();
    expect(context.symbols?.length).toBeGreaterThan(0);
  });
});
