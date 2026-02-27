import { text } from '../../../locales/index.js';
import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export interface PrimaryTextResult {
  primaryText?: string;
}

export class PrimaryTextGatherer {
  private readonly fileAdapter = new FileAdapter();

  async gather(req: ContextRequest): Promise<PrimaryTextResult> {
    let primaryText: string | undefined;

    if (req.primaryFile) {
      if (req.snapshotHash && req.checkpointManager) {
        const snapshotContent = await req.checkpointManager.readSnapshotFile(
          req.repoPath,
          req.snapshotHash,
          req.primaryFile,
        );
        primaryText = snapshotContent === null ? undefined : snapshotContent;

        if (primaryText === undefined) {
          // Keep legacy error semantics for now to avoid unexpected behavior changes.
          throw new Error(
            `File ${req.primaryFile} not found in snapshot ${req.snapshotHash}. This may happen if the file is ignored and not explicitly included.`,
          );
        }
      } else {
        const filePath = defaultPathAdapter.isAbsolute(req.primaryFile)
          ? req.primaryFile
          : safeJoin(req.repoPath, req.primaryFile);
        primaryText = await this.fileAdapter.readFile(filePath, 'utf-8');
      }
    } else if (req.selection) {
      primaryText = req.selection;
    }

    if (primaryText && primaryText.length > LIMITS.maxPrimaryChars) {
      primaryText =
        primaryText.substring(0, LIMITS.maxPrimaryChars) + `\n${text.context.contentTruncated}`;
    }

    return { primaryText };
  }
}
