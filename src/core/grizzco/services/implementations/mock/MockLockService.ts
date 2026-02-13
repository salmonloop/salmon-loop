import { logger } from '../../../../logger.js';
import { AstValidateCtx } from '../../../engine/pipeline/types.js';
import { IDataService } from '../../types.js';

export class MockLockService implements IDataService {
  readonly id = 'remote_lock';

  async fetch(_ctx: AstValidateCtx, filePath?: string): Promise<any> {
    logger.debug(
      `[MockLockService] Checking remote lock status for ${filePath || 'unknown file'}...`,
    );

    // Simulate async fetch
    await new Promise((resolve) => setTimeout(resolve, 10));

    return { isLocked: false, owner: null };
  }
}
