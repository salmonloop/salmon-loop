import { GitAdapter } from '../../../../adapters/git/git-adapter.js';
import { logger } from '../../../../observability/logger.js';
import { AstValidateCtx } from '../../../engine/pipeline/types.js';
import { IDataService } from '../../types.js';

export class GitConfigService implements IDataService {
  readonly id = 'git_config';

  async fetch(ctx: AstValidateCtx, _filePath?: string): Promise<any> {
    logger.debug('[GitConfigService] Fetching git configuration...');

    try {
      const git = new GitAdapter(ctx.workspace.workPath);

      const getConfig = async (key: string) => {
        try {
          return await git.exec(['config', '--get', key], { allowError: true });
        } catch {
          return null;
        }
      };

      const [userName, userEmail, remoteOrigin] = await Promise.all([
        getConfig('user.name'),
        getConfig('user.email'),
        getConfig('remote.origin.url'),
      ]);

      return {
        user: {
          name: userName || null,
          email: userEmail || null,
        },
        remote: {
          origin: remoteOrigin || null,
        },
      };
    } catch (error) {
      logger.warn(`[GitConfigService] Failed to fetch config: ${error}`);
      return { user: {}, remote: {} };
    }
  }
}
