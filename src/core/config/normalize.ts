import type { PermissionMode, UiLogMode, UiLogView } from './types.js';

export function normalizeUiLogView(raw: unknown): UiLogView | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'full' || value === 'verbose') return 'full';
  if (value === 'standard' || value === 'normal') return 'standard';
  if (value === 'compact' || value === 'dense') return 'compact';
  return undefined;
}

export function normalizeUiLogMode(raw: unknown): UiLogMode | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'quiet' || value === 'minimal') return 'quiet';
  if (value === 'normal' || value === 'default') return 'normal';
  if (value === 'debug' || value === 'all') return 'debug';
  return undefined;
}

export function normalizePermissionMode(raw: unknown): PermissionMode | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'interactive') return 'interactive';
  if (value === 'yolo') return 'yolo';
  return undefined;
}
