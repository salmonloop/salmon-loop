import * as path from 'path';

import * as fs from '../../adapters/fs/node-fs.js';
import { getLogger } from '../../observability/logger.js';
import { TransactionContext } from '../domain/grizzco-types.js';

export interface Rejection {
  filePath: string;
  reason: string;
  timestamp: number;
  context: {
    fileStatus: string;
    operationType: string;
  };
}

/**
 * RejectionManager
 * Handles creation and management of .rej files for failed merges.
 */
export class RejectionManager {
  constructor(private rejectDir: string) {}

  /**
   * Create a rejection file.
   */
  async create(filePath: string, reason: string, context: TransactionContext): Promise<void> {
    // Sanitize path for filename
    const safeName = filePath.replace(/[/\\]/g, '_');
    const rejPath = path.join(this.rejectDir, `${safeName}.rej`);

    const header = JSON.stringify({
      reason,
      timestamp: Date.now(),
      fileStatus: context.file.status,
      operationType: context.operation.type,
    });

    const content = context.operation.content ? context.operation.content.toString('utf-8') : '';

    const fileBody = `${header}\n\n${content}`;

    await fs.mkdir(this.rejectDir, { recursive: true });
    await fs.writeFile(rejPath, fileBody, 'utf-8');
  }

  /**
   * List all rejections.
   */
  async list(): Promise<Rejection[]> {
    try {
      const files = await fs.readdir(this.rejectDir);
      const rejFiles = files.filter((f) => f.endsWith('.rej'));
      const rejections: Rejection[] = [];

      // Chunk size of 10 to prevent EMFILE limits while improving throughput
      for (let i = 0; i < rejFiles.length; i += 10) {
        const chunk = rejFiles.slice(i, i + 10);
        const results = await Promise.all(
          chunk.map(async (file) => {
            try {
              const content = await fs.readFile(path.join(this.rejectDir, file), 'utf-8');
              const headerPart = content.split('\n\n')[0];
              const header = JSON.parse(headerPart);
              return {
                filePath: file.replace('.rej', '').replace(/_/g, '/'), // Approximate restoration
                ...header,
              };
            } catch (error) {
              getLogger().debug(
                `[RejectionManager] Malformed rejection file ${file}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            }
          }),
        );

        for (const res of results) {
          if (res) rejections.push(res);
        }
      }

      return rejections;
    } catch (error) {
      getLogger().debug(
        `[RejectionManager] Failed to read rejection directory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Clear rejection directory
   */
  async clear(): Promise<void> {
    try {
      await fs.rm(this.rejectDir, { recursive: true, force: true });
    } catch (error) {
      getLogger().warn(
        `[RejectionManager] Failed to clear rejection directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
