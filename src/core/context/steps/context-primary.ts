import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextPipelineInitCtx, ContextPrimaryCtx } from './types.js';

export function buildContextPrimaryStep(deps: ContextServiceDeps) {
  return async ({ req, diffScope }: ContextPipelineInitCtx): Promise<ContextPrimaryCtx> => {
    assertNotAborted(req.signal);
    const { primaryText } = await deps.primaryTextGatherer.gather(req);
    assertNotAborted(req.signal);
    return { req, diffScope, primaryText };
  };
}
