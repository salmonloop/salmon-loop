import { logger } from '../../../../logger.js';
import { AstValidateCtx } from '../../../engine/pipeline/types.js';
import { IDataService } from '../../types.js';

export class MockUserQuotaService implements IDataService {
  readonly id = 'user_quota';

  async fetch(_ctx: AstValidateCtx, _filePath?: string): Promise<any> {
    logger.debug('[MockUserQuotaService] Checking user quota...');

    // Simulate async fetch
    await new Promise((resolve) => setTimeout(resolve, 10));

    return { remaining: 1000 };
  }
}
