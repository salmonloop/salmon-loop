import { describe, expect, it } from 'vitest';

import { InMemoryLockManager } from '../../../src/core/tools/parallel/lock-manager.js';
import type { ExecutionPlan } from '../../../src/core/tools/parallel/plan.js';
import { ParallelScheduler } from '../../../src/core/tools/parallel/scheduler.js';
import type { ToolSpec, ToolRuntimeCtx } from '../../../src/core/tools/types.js';
import { Phase } from '../../../src/core/types.js';

type CallHandler = (args: any) => Promise<any>;

class FakeRouter {
  private handlers = new Map<string, CallHandler>();
  private specs = new Map<string, ToolSpec>();

  register(spec: ToolSpec, handler: CallHandler) {
    this.specs.set(spec.name, spec);
    this.handlers.set(spec.name, handler);
  }

  getSpec(name: string) {
    return this.specs.get(name);
  }

  async call({ toolName, args }: { toolName: string; args: any }) {
    const handler = this.handlers.get(toolName);
    if (!handler) throw new Error(`No handler for ${toolName}`);
    const output = await handler(args);
    return { status: 'ok', output };
  }
}

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const baseCtx: ToolRuntimeCtx = {
  repoRoot: '/repo',
  attemptId: 1,
  dryRun: false,
};

const readSpec: ToolSpec = {
  name: 'fs.read',
  source: 'builtin',
  description: 'read',
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  allowedPhases: [Phase.CONTEXT],
  inputSchema: {} as any,
  outputSchema: {} as any,
  computeResources: (_input, ctx) => [{ kind: 'pathPrefix', repoId: ctx.repoRoot, prefix: 'src/' }],
  executor: async () => ({}),
};

const writeSpec: ToolSpec = {
  name: 'fs.write',
  source: 'builtin',
  description: 'write',
  riskLevel: 'medium',
  sideEffects: ['fs_write'],
  concurrency: 'mutex_by_resource',
  allowedPhases: [Phase.CONTEXT],
  inputSchema: {} as any,
  outputSchema: {} as any,
  computeResources: (_input, ctx) => [{ kind: 'pathPrefix', repoId: ctx.repoRoot, prefix: 'src/' }],
  executor: async () => ({}),
};

describe('ParallelScheduler', () => {
  it('blocks write execution while a read lock is held on the same resource', async () => {
    const events: string[] = [];
    const router = new FakeRouter();
    const readGate = deferred<void>();
    const writeGate = deferred<void>();
    const readStarted = deferred<void>();
    const writeStarted = deferred<void>();
    let writeStartedFlag = false;

    router.register(readSpec, async () => {
      events.push('read:start');
      readStarted.resolve();
      await readGate.promise;
      events.push('read:end');
      return { ok: true };
    });
    router.register(writeSpec, async () => {
      events.push('write:start');
      writeStartedFlag = true;
      writeStarted.resolve();
      await writeGate.promise;
      events.push('write:end');
      return { ok: true };
    });

    const scheduler = new ParallelScheduler(router as any, new InMemoryLockManager());
    const plan: ExecutionPlan = {
      id: 'plan-1',
      policy: {
        maxParallelism: 4,
        failFast: true,
        deterministic: true,
        readParallelism: 2,
        writeParallelism: 1,
      },
      nodes: [
        { id: 'n1', toolName: 'fs.read', args: {}, deps: [] },
        { id: 'n2', toolName: 'fs.write', args: {}, deps: [] },
      ],
    };

    const runPromise = scheduler.run(plan, baseCtx, new AbortController().signal);

    await readStarted.promise;

    expect(events).toEqual(['read:start']);
    expect(writeStartedFlag).toBe(false);

    readGate.resolve();
    await writeStarted.promise;

    expect(events).toEqual(['read:start', 'read:end', 'write:start']);

    writeGate.resolve();
    const result = await runPromise;
    expect(result.failed).toBe(false);
  });

  it('cancels dependent nodes when a dependency fails', async () => {
    const router = new FakeRouter();
    const events: string[] = [];

    router.register(readSpec, async () => {
      events.push('dep:start');
      throw new Error('boom');
    });
    router.register(writeSpec, async () => {
      events.push('downstream:start');
      return { ok: true };
    });

    const scheduler = new ParallelScheduler(router as any, new InMemoryLockManager());
    const plan: ExecutionPlan = {
      id: 'plan-2',
      policy: { maxParallelism: 2, failFast: false, deterministic: true },
      nodes: [
        { id: 'n1', toolName: 'fs.read', args: {}, deps: [] },
        { id: 'n2', toolName: 'fs.write', args: {}, deps: ['n1'] },
      ],
    };

    const result = await scheduler.run(plan, baseCtx, new AbortController().signal);

    expect(events).toEqual(['dep:start']);
    expect(result.nodeResults['n1'].status).toBe('FAILED');
    expect(result.nodeResults['n2'].status).toBe('CANCELED');
  });
});
