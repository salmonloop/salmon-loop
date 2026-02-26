import { resolveExtensions, ExtensionConfigError } from '../../../core/extensions/index.js';
import type { ExtensionResolution } from '../../../core/extensions/index.js';
import { logger } from '../../../core/observability/logger.js';

export async function resolveRunExtensions(params: {
  repoPath: string;
  outputFormat: 'text' | 'json' | 'stream-json';
  writeJsonFailure: (args: { message: string; repoPath?: string }) => void;
}): Promise<{ ok: true; extensionResolution?: ExtensionResolution } | { ok: false; exitCode: 1 }> {
  try {
    const extensionResolution = await resolveExtensions({ repoRoot: params.repoPath });
    return { ok: true, extensionResolution };
  } catch (err: unknown) {
    if (err instanceof ExtensionConfigError) {
      logger.error(`Extension configuration invalid: ${err.message}`);
      if (params.outputFormat === 'json') {
        params.writeJsonFailure({
          message: `Extension configuration invalid: ${err.message}`,
          repoPath: params.repoPath,
        });
      }
      return { ok: false, exitCode: 1 };
    }
    throw err;
  }
}
