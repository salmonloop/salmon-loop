import type { VerboseLevel } from '../../core/types/execution.js';

export function resolveVerboseLevel(raw: unknown): VerboseLevel | undefined {
  if (raw === true) return 'basic';
  if (typeof raw === 'string') return raw as VerboseLevel;
  return undefined;
}
