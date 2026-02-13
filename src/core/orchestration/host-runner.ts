import { createFileSystemAdapter } from '../adapters/fs/index.js';
import { recordAuditEvent } from '../audit-trail.js';
import { sanitizeError } from '../llm/errors.js';
import { initPlan } from '../plan/index.js';
import { RuntimeEnvironment } from '../strata/runtime/environment.js';
import type { FlowMode, FileSystem, LoopEvent, LoopOptions } from '../types.js';

import type { HostBootContext, PlanRuntimeContext } from './types.js';

export type RuntimeEnvironmentCtor = typeof RuntimeEnvironment;

export class HostRunner {
  private env?: RuntimeEnvironment;
  private planRuntime?: PlanRuntimeContext;
  private readonly flowMode: FlowMode;
  private readonly fsAdapter: FileSystem;
  static runtimeEnvironmentCtor: RuntimeEnvironmentCtor = RuntimeEnvironment;

  constructor(
    private readonly options: LoopOptions,
    private readonly emit: (event: LoopEvent) => void,
    private readonly now: () => Date,
  ) {
    this.flowMode = options.mode ?? 'patch';
    this.fsAdapter = createFileSystemAdapter(this.flowMode);
  }

  async boot(): Promise<HostBootContext> {
    this.env = new HostRunner.runtimeEnvironmentCtor(this.options, this.emit);
    await this.env.setup();

    const activeRepoPath = this.env.activeRepoPath;
    this.emit({
      type: 'workspace.ready',
      path: activeRepoPath,
      strategy: this.options.strategy || 'local',
      timestamp: this.now(),
    });

    await this.initializePlanRuntime(activeRepoPath);

    return {
      env: this.env,
      flowMode: this.flowMode,
      fsAdapter: this.fsAdapter,
      activeRepoPath,
      planRuntime: this.planRuntime,
    };
  }

  async teardown(): Promise<void> {
    if (!this.env) return;
    try {
      await this.env.teardown();
    } finally {
      this.env = undefined;
    }
  }

  private async initializePlanRuntime(activeRepoPath: string): Promise<void> {
    try {
      const initialized = await initPlan({
        persistenceRoot: this.env!.workspace!.baseRepoPath || activeRepoPath,
        mission: this.options.instruction,
        objective: 'Track task progress and support resumable execution.',
        context: `mode=${this.flowMode}\nverify=${this.options.verify}\nstrategy=${this.options.strategy ?? 'local'}`,
      });
      this.planRuntime = {
        sessionId: initialized.sessionId,
        planPathHint: initialized.planPathHint,
      };
      recordAuditEvent(
        'plan.runtime.init',
        {
          sessionId: initialized.sessionId,
          planPathHint: initialized.planPathHint,
        },
        { source: 'plan', severity: 'low', scope: 'session', phase: 'PREFLIGHT' },
      );
      this.emit({
        type: 'plan.runtime.ready',
        sessionId: initialized.sessionId,
        planPathHint: initialized.planPathHint,
        timestamp: this.now(),
      });
      this.emit({
        type: 'log',
        level: 'debug',
        message: `Runtime plan initialized: sessionId=${initialized.sessionId}`,
        timestamp: this.now(),
      });
    } catch (error) {
      const reason = sanitizeError(error);
      this.emit({
        type: 'plan.runtime.unavailable',
        reason,
        timestamp: this.now(),
      });
      recordAuditEvent(
        'plan.runtime.init.failed',
        { error: reason },
        { source: 'plan', severity: 'medium', scope: 'session', phase: 'PREFLIGHT' },
      );
      this.emit({
        type: 'log',
        level: 'warn',
        message: `Runtime plan init failed (continuing without plan): ${reason}`,
        timestamp: this.now(),
      });
    }
  }
}
