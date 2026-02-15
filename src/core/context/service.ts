import { Pipeline } from '../grizzco/engine/pipeline/pipeline.js';
import { logger } from '../observability/logger.js';

import type { ContextServiceDeps } from './service-deps.js';
import { defaultContextServiceDeps } from './service-deps.js';
import { buildContextBudgetStep } from './steps/context-budget.js';
import { buildContextGatherStep } from './steps/context-gather.js';
import { buildContextPrimaryStep } from './steps/context-primary.js';
import { buildContextTargetsStep } from './steps/context-targets.js';
import type { ContextRequest, ContextResult, DiffScope } from './types.js';

export class ContextService {
  private readonly deps: ContextServiceDeps;

  constructor(deps: Partial<ContextServiceDeps> = {}) {
    this.deps = { ...defaultContextServiceDeps(), ...deps };
  }

  async build(req: ContextRequest): Promise<ContextResult> {
    const diffScope: DiffScope = req.diffScope ?? 'primary';

    logger.trace(`  [CONTEXT] Building context for repo: ${req.repoPath}`);
    logger.trace(`  [CONTEXT] File: ${req.primaryFile}, Instruction: ${req.instruction}`);

    const report = await Pipeline.of({ req, diffScope })
      .step('CONTEXT_PRIMARY', buildContextPrimaryStep(this.deps))
      .step('CONTEXT_GATHER', buildContextGatherStep(this.deps))
      .step('CONTEXT_TARGETS', buildContextTargetsStep(this.deps))
      .step('CONTEXT_BUDGET', buildContextBudgetStep(this.deps))
      .execute();
    if (!report.success) {
      throw report.error ?? new Error('Context pipeline failed');
    }
    return report.data as ContextResult;
  }
}
