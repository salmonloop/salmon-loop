import { createHash } from 'node:crypto';

import { readdir, readFile, stat } from '../../adapters/fs/node-fs.js';
import type { RuntimeArtifacts } from '../../types/context.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export class ArtifactGatherer {
  private static readonly COMMON_BUILD_DIRS = ['dist', 'build', 'out', 'target', 'bin'];
  private static readonly CRITICAL_LOCK_FILES = [
    'package-lock.json',
    'bun.lock',
    'pnpm-lock.yaml',
    'yarn.lock',
    'Cargo.lock',
    'go.sum',
    'requirements.txt',
  ];

  async gather(req: ContextRequest): Promise<RuntimeArtifacts> {
    const { repoPath } = req;
    const artifacts: RuntimeArtifacts = {
      buildDirs: [],
      lockFiles: [],
      envVars: [],
    };

    // 1. Detect Build Dirs
    try {
      const rootEntries = await readdir(repoPath);
      artifacts.buildDirs = rootEntries.filter((e) =>
        ArtifactGatherer.COMMON_BUILD_DIRS.includes(e),
      );
    } catch {
      /* Ignore */
    }

    // 2. Lock Files & Hashes
    for (const lock of ArtifactGatherer.CRITICAL_LOCK_FILES) {
      try {
        const lockPath = safeJoin(repoPath, lock);
        const lockStat = await stat(lockPath);
        if (lockStat.isFile()) {
          // For large lock files, we only take a partial hash to be fast
          const content = await readFile(lockPath, 'utf-8');
          const hash = createHash('md5').update(content.slice(0, 5000)).digest('hex');
          artifacts.lockFiles?.push({ path: lock, hash });
        }
      } catch {
        /* Ignore */
      }
    }

    // 3. Selective Env Vars (Names only, no values for security)
    const safeEnvPrefixes = ['NODE_', 'BUN_', 'JAVA_', 'PYTHON_', 'GO_', 'CI', 'DEBUG'];
    artifacts.envVars = Object.keys(process.env).filter((key) =>
      safeEnvPrefixes.some((p) => key.startsWith(p)),
    );

    return artifacts;
  }
}
