import { AstValidateCtx } from '../engine/pipeline/types.js';

/**
 * Generic data service interface
 */
export interface IDataService {
  /**
   * Unique service identifier (corresponds to requireData key)
   */
  readonly id: string;

  /**
   * Asynchronously fetch data
   * @param ctx Current validation context
   * @param filePath Optional file path for path-sensitive data (e.g. locks)
   */
  fetch(ctx: AstValidateCtx, filePath?: string): Promise<any>;
}
