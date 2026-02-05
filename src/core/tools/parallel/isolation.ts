import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface IsolatedEnv {
  tmpDir: string;
  env: Record<string, string>;
  dispose: () => Promise<void>;
}

export class IsolationManager {
  async create(): Promise<IsolatedEnv> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'salmon-parallel-'));
    const tempIndex = join(tmpDir, 'index');

    return {
      tmpDir,
      env: {
        GIT_INDEX_FILE: tempIndex,
        TMPDIR: tmpDir,
      },
      dispose: async () => {
        try {
          await rm(tmpDir, { recursive: true, force: true });
        } catch (_e) {
          // Ignore cleanup errors
        }
      },
    };
  }
}
