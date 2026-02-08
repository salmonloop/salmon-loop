import { join } from 'path';

import { FileAdapter } from '../adapters/fs/index.js';

/**
 * Manages persistence of user input history isolated by Session.
 * Storage path: .salmonloop/ui-history/{sessionId}.json
 */
export class InputHistoryManager {
  private storageDir: string;
  private fileAdapter = new FileAdapter();
  private maxHistory = 500;

  constructor(repoPath: string) {
    this.storageDir = join(repoPath, '.salmonloop', 'ui-history');
  }

  /**
   * Initialize the storage directory
   */
  async init(): Promise<void> {
    await this.fileAdapter.mkdir(this.storageDir);
  }

  /**
   * Load input history for a specific Session
   */
  async load(sessionId: string): Promise<string[]> {
    const filePath = join(this.storageDir, `${sessionId}.json`);
    try {
      const data = await this.fileAdapter.readFile(filePath);
      return JSON.parse(data) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Append and persist new input
   */
  async append(sessionId: string, input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Rule: Exclude slash commands from history (AGENTS.md line 36)
    if (trimmed.startsWith('/')) {
      return;
    }

    const history = await this.load(sessionId);

    // Deduplication: Don't record if identical to the last entry
    if (history.length > 0 && history[history.length - 1] === trimmed) {
      return;
    }

    history.push(trimmed);
    const updatedHistory = history.slice(-this.maxHistory);

    const filePath = join(this.storageDir, `${sessionId}.json`);
    await this.fileAdapter.writeFile(filePath, JSON.stringify(updatedHistory, null, 2));
  }
}
