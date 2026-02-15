import { CONTEXT_AUDIT_ACTION, CONTEXT_AUDIT_PHASE } from '../audit-constants.js';
import { recordContextAuditEvent } from '../audit.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextPipelineInitCtx, ContextPrimaryCtx } from './types.js';

export function buildContextPrimaryStep(deps: ContextServiceDeps) {
  return async ({ req, diffScope }: ContextPipelineInitCtx): Promise<ContextPrimaryCtx> => {
    assertNotAborted(req.signal);
    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.inputSummary,
      {
        hasPrimaryFile: Boolean(req.primaryFile),
        hasSelection: Boolean(req.selection),
        instructionChars: req.instruction?.length ?? 0,
        diffScope,
        budgetChars: req.budgetChars ?? null,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.primary },
    );
    const { primaryText } = await deps.primaryTextGatherer.gather(req);
    assertNotAborted(req.signal);
    return { req, diffScope, primaryText };
  };
}
