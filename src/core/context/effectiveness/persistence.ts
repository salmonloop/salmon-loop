/**
 * Effectiveness data persistence.
 *
 * Saves and restores tracker state across sessions.
 * Data is stored in `.salmonloop/runtime/effectiveness.json`.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';

import { defaultPathAdapter } from '../../adapters/path/path-adapter.js';
import { logIgnoredError } from '../../observability/ignored-error.js';
import { getLogger } from '../../observability/logger.js';

import { getEffectivenessTracker } from './tracker.js';
import type { SerializedEffectiveness } from './tracker.js';

const EFFECTIVENESS_FILE = 'effectiveness.json';

function getEffectivenessPath(repoRoot: string): string {
  return defaultPathAdapter.join(repoRoot, '.salmonloop', 'runtime', EFFECTIVENESS_FILE);
}

/**
 * Persist current tracker state to disk.
 */
export async function persistEffectiveness(repoRoot: string): Promise<void> {
  try {
    const tracker = getEffectivenessTracker();
    const data = tracker.serialize();
    const filePath = getEffectivenessPath(repoRoot);
    await mkdir(defaultPathAdapter.join(repoRoot, '.salmonloop', 'runtime'), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logIgnoredError('[Effectiveness] Failed to persist', error);
  }
}

/**
 * Restore tracker state from disk.
 * Silently returns if no saved data exists.
 */
export async function restoreEffectiveness(repoRoot: string): Promise<void> {
  try {
    const filePath = getEffectivenessPath(repoRoot);
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as SerializedEffectiveness;
    if (data && typeof data === 'object') {
      const tracker = getEffectivenessTracker();
      tracker.deserialize(data);
    }
  } catch (error) {
    // File missing or corrupted — start fresh
    getLogger().debug(
      `[Effectiveness] restore failed, starting fresh: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
