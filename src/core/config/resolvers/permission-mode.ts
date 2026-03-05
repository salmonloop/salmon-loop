import { normalizePermissionMode } from '../normalize.js';
import type { ConfigFileV1, PermissionMode } from '../types.js';

export function resolvePermissionMode(raw?: ConfigFileV1): PermissionMode {
  const cfg = normalizePermissionMode(raw?.mode);
  return cfg ?? 'interactive';
}
