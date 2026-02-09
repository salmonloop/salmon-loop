import { ToolRouter } from '../router.js';
import { ToolResult, ToolRuntimeCtx, ToolSpec } from '../types.js';

import { IsolationManager } from './isolation.js';
import {
  ApprovalRequest,
  ExecutionPlan,
  NodeId,
  NodeResult,
  NodeStatus,
  PlanRecording,
  PlanRunOptions,
  PlanRunResult,
} from './plan.js';
import { resolveArgsWithResults } from './resolve-args.js';
import { processResource, repoResource } from './resource-helpers.js';
import { LockManager } from './resources.js';

export class ParallelScheduler {
  constructor(
    private router: ToolRouter,
    private locks: LockManager,
    private isolation: IsolationManager = new IsolationManager(),
  ) {}

  private resolveSpec(node: { toolName: string; spec?: ToolSpec }): ToolSpec {
    if (node.spec) return node.spec;
    const spec =
      typeof this.router.getSpec === 'function' ? this.router.getSpec(node.toolName) : undefined;
    if (!spec) {
      throw new Error(`Tool spec not found for ${node.toolName}`);
    }
    node.spec = spec;
    return spec;
  }

  private deriveDefaultResources(spec: ToolSpec, ctx: ToolRuntimeCtx) {
    const writeEffects = new Set(['fs_write', 'git_write', 'snapshot_mutate']);
    const hasWrite = spec.sideEffects.some((effect) => writeEffects.has(effect));
    const hasProcess = spec.sideEffects.includes('process');

    if (hasWrite || hasProcess) {
      const resources = [repoResource(ctx)];
      if (hasProcess) resources.push(processResource(ctx));
      return resources;
    }

    if (spec.sideEffects.includes('fs_read') || spec.sideEffects.includes('git_read')) {
      return [repoResource(ctx)];
    }

    return [];
  }

  async run(
    plan: ExecutionPlan,
    ctx: ToolRuntimeCtx,
    signal: AbortSignal,
    options?: PlanRunOptions,
  ): Promise<PlanRunResult> {
    const recordEnabled = Boolean(
      options?.record ?? (plan.policy.deterministic && !options?.replay),
    );
    const nodeResults: Record<NodeId, NodeResult> = { ...(options?.initialResults ?? {}) };
    const running = new Set<Promise<void>>();
    const blockedApprovals: ApprovalRequest[] = [];
    const recording: PlanRecording = { steps: [] };
    let stepCount = 0;

    // Internal state tracking
    const nodeStates = new Map<NodeId, NodeStatus>();
    for (const node of plan.nodes) {
      const seeded = nodeResults[node.id];
      if (seeded?.status === 'SUCCEEDED') {
        nodeStates.set(node.id, 'SUCCEEDED');
        continue;
      }
      if (seeded?.status === 'FAILED') {
        nodeStates.set(node.id, 'FAILED');
        continue;
      }
      if (seeded?.status === 'CANCELED') {
        nodeStates.set(node.id, 'CANCELED');
        continue;
      }
      if (seeded?.status === 'BLOCKED_APPROVAL') {
        nodeStates.set(node.id, options?.resumeBlockedApprovals ? 'READY' : 'BLOCKED_APPROVAL');
        continue;
      }
      nodeStates.set(node.id, (node.deps?.length ?? 0) > 0 ? 'PENDING' : 'READY');
    }

    const readLimit = plan.policy.readParallelism ?? plan.policy.maxParallelism;
    const writeLimit = plan.policy.writeParallelism ?? 1;

    let readRunning = 0;
    let writeRunning = 0;

    const updateDeps = () => {
      for (const node of plan.nodes) {
        if (nodeStates.get(node.id) !== 'PENDING') continue;

        const deps = node.deps ?? [];
        if (deps.length === 0) {
          nodeStates.set(node.id, 'READY');
          continue;
        }

        const depResults = deps.map((depId) => nodeResults[depId]);
        const hasFailedDep = depResults.some(
          (res) => res?.status === 'FAILED' || res?.status === 'CANCELED',
        );
        if (hasFailedDep) {
          nodeStates.set(node.id, 'CANCELED');
          nodeResults[node.id] = {
            status: 'CANCELED',
            error: 'Dependency failed or was canceled',
          };
          continue;
        }

        const allDepsDone = depResults.every((res) => res?.status === 'SUCCEEDED');
        if (allDepsDone) {
          nodeStates.set(node.id, 'READY');
        }
      }
    };

    const cancelRemaining = () => {
      for (const node of plan.nodes) {
        const state = nodeStates.get(node.id);
        if (state === 'PENDING' || state === 'READY') {
          nodeStates.set(node.id, 'CANCELED');
          nodeResults[node.id] = { status: 'CANCELED' };
        }
      }
    };

    const getLane = (spec: ToolSpec): 'read' | 'write' => {
      if (spec.concurrency === 'serial_only' || spec.concurrency === 'isolated') return 'write';
      const writeEffects = new Set(['fs_write', 'git_write', 'snapshot_mutate', 'process']);
      if (spec.sideEffects.some((effect) => writeEffects.has(effect))) return 'write';
      return spec.concurrency === 'parallel_ok' ? 'read' : 'write';
    };

    const startNode = async (nodeId: string) => {
      const node = plan.nodes.find((n) => n.id === nodeId)!;
      let lane: 'read' | 'write' | null = null;

      try {
        const spec = this.resolveSpec(node);
        lane = getLane(spec);

        nodeStates.set(nodeId, 'RUNNING');
        if (lane === 'read') readRunning++;
        else if (lane === 'write') writeRunning++;

        if (recordEnabled) {
          recording.steps.push({
            t: stepCount++,
            picked: nodeId,
            readySet: Array.from(nodeStates.entries())
              .filter(([_, s]) => s === 'READY' || s === 'RUNNING') // Include current node which was READY
              .map(([id]) => id),
            readRunning,
            writeRunning: writeRunning || 0,
          });
        }

        // 1. Resolve Arguments
        const resolvedArgs = resolveArgsWithResults(node.args, nodeResults);

        // 1.5 Deferred authorization preflight (avoid holding locks while waiting for user)
        const preflight =
          typeof (this.router as any).preflightDeferredAuthorization === 'function'
            ? await (this.router as any).preflightDeferredAuthorization({
                id: nodeId,
                phase: (ctx as any).phase || 'execute',
                toolName: node.toolName,
                args: resolvedArgs,
                ctx,
              })
            : null;
        if (preflight?.kind === 'pending') {
          nodeStates.set(nodeId, 'BLOCKED_APPROVAL');
          const approval: ApprovalRequest = {
            nodeId,
            toolName: node.toolName,
            riskLevel: spec.riskLevel,
            message: preflight.message || 'Approval required',
            confirmToken: preflight.challenge,
          };
          nodeResults[nodeId] = {
            status: 'BLOCKED_APPROVAL',
            approval,
            toolResult: preflight.toolResult,
            timing: { lockWaitMs: 0, runMs: 0 },
          };
          blockedApprovals.push(approval);
          return;
        }
        if (preflight?.kind === 'denied') {
          nodeStates.set(nodeId, 'FAILED');
          nodeResults[nodeId] = {
            status: 'FAILED',
            error: preflight.toolResult?.error,
            toolResult: preflight.toolResult,
            timing: { lockWaitMs: 0, runMs: 0 },
          };
          if (plan.policy.failFast) cancelRemaining();
          return;
        }

        // 2. Compute Resources (JIT)
        const resources =
          node.resources ??
          spec.computeResources?.(resolvedArgs, ctx) ??
          this.deriveDefaultResources(spec, ctx);
        node.resources = resources;

        // 3. Acquire Locks
        const mode = lane === 'read' ? 'read' : 'write';
        const lockStart = Date.now();
        const lockHandle = await this.locks.acquire(resources, mode, signal);
        const lockWaitMs = Date.now() - lockStart;

        const isolatedEnv = spec.concurrency === 'isolated' ? await this.isolation.create() : null;

        try {
          // 4. Execute via Router
          const runStart = Date.now();
          const result = await this.router.call({
            id: nodeId,
            phase: (ctx as any).phase || 'execute',
            toolName: node.toolName,
            args: resolvedArgs,
            ctx: isolatedEnv ? { ...ctx, env: { ...ctx.env, ...isolatedEnv.env } } : ctx,
          });
          const runMs = Date.now() - runStart;
          const timing = { lockWaitMs, runMs };

          if (result.status === 'ok') {
            nodeStates.set(nodeId, 'SUCCEEDED');
            nodeResults[nodeId] = {
              status: 'SUCCEEDED',
              output: result.output,
              toolResult: result,
              timing,
            };
          } else if (result.status === 'denied' && result.error?.code === 'AUTH_REQUIRED') {
            nodeStates.set(nodeId, 'BLOCKED_APPROVAL');
            const approval: ApprovalRequest = {
              nodeId,
              toolName: node.toolName,
              riskLevel: spec.riskLevel,
              message: result.error.message || 'Approval required',
              confirmToken: (result.error as any).confirmToken,
            };
            nodeResults[nodeId] = {
              status: 'BLOCKED_APPROVAL',
              approval,
              toolResult: result,
              timing,
            };
            blockedApprovals.push(approval);
          } else {
            nodeStates.set(nodeId, 'FAILED');
            nodeResults[nodeId] = {
              status: 'FAILED',
              error: result.error,
              toolResult: result,
              timing,
            };
            if (plan.policy.failFast) cancelRemaining();
          }
        } finally {
          if (isolatedEnv) {
            await isolatedEnv.dispose();
          }
          lockHandle.release();
        }
      } catch (e) {
        nodeStates.set(nodeId, 'FAILED');
        const error =
          e instanceof Error
            ? { code: 'EXECUTION_ERROR', message: e.message, stack: e.stack }
            : { code: 'EXECUTION_ERROR', message: String(e) };

        const toolResult: ToolResult = {
          id: nodeId,
          toolName: node.toolName,
          source: 'builtin',
          status: 'error',
          error: error as any,
        };

        nodeResults[nodeId] = {
          status: 'FAILED',
          error: error as any,
          toolResult,
          timing: { lockWaitMs: 0, runMs: 0 },
        };
        if (plan.policy.failFast) cancelRemaining();
      } finally {
        if (lane === 'read') readRunning--;
        else if (lane === 'write') writeRunning--;
      }
    };

    // Main scheduling loop
    while (!signal.aborted) {
      updateDeps();

      let scheduledInThisTick = 0;
      // If replaying, we strictly follow the recording
      if (options?.replay) {
        const nextStep = options.replay.steps[stepCount];
        if (nextStep) {
          const nodeState = nodeStates.get(nextStep.picked);
          if (nodeState === 'READY') {
            const node = plan.nodes.find((n) => n.id === nextStep.picked)!;
            const lane = getLane(this.resolveSpec(node));
            if (
              readRunning + writeRunning < plan.policy.maxParallelism &&
              ((lane === 'read' && readRunning < readLimit) ||
                (lane === 'write' && writeRunning < writeLimit))
            ) {
              const p = startNode(node.id).finally(() => running.delete(p));
              running.add(p);
              scheduledInThisTick++;
              stepCount++; // stepCount is incremented here for replay, or inside startNode for recording
            }
          }
        }
      } else {
        for (const node of plan.nodes) {
          if (nodeStates.get(node.id) !== 'READY') continue;

          const spec = this.resolveSpec(node);
          const lane = getLane(spec);

          if (readRunning + writeRunning >= plan.policy.maxParallelism) {
            break;
          }

          if (lane === 'read' && readRunning < readLimit) {
            const p = startNode(node.id).finally(() => running.delete(p));
            running.add(p);
            scheduledInThisTick++;
          } else if (lane === 'write' && writeRunning < writeLimit) {
            const p = startNode(node.id).finally(() => running.delete(p));
            running.add(p);
            scheduledInThisTick++;
          }
        }
      }

      if (scheduledInThisTick === 0) {
        if (running.size === 0) break; // All done or blocked
        await Promise.race(running);
      }
    }

    await Promise.allSettled(running);

    for (const node of plan.nodes) {
      if (!nodeResults[node.id]) {
        nodeResults[node.id] = { status: nodeStates.get(node.id) ?? 'PENDING' };
      }
    }

    const failed = Object.values(nodeResults).some((r) => r.status === 'FAILED');
    const canceled = Object.values(nodeResults).some((r) => r.status === 'CANCELED');

    return {
      planId: plan.id,
      nodeResults,
      failed,
      canceled,
      blockedApprovals,
      recording: recordEnabled ? recording : undefined,
    };
  }
}
