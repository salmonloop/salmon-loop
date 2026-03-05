import { normalizeUiLogMode, normalizeUiLogView } from '../normalize.js';
import { DEFAULT_UI_LOG_MODE, DEFAULT_UI_LOG_VIEW } from '../types.js';
import type { ConfigFileV1, UiLogMode, UiLogView } from '../types.js';

export function resolveUiLogMode(raw?: ConfigFileV1): UiLogMode {
  const env =
    normalizeUiLogMode(process.env.SALMONLOOP_UI_LOG_MODE) ??
    normalizeUiLogMode(process.env.SALMONLOOP_UI_MODE);
  if (env) return env;

  const cfg = normalizeUiLogMode(raw?.ui?.log?.mode);
  return cfg ?? DEFAULT_UI_LOG_MODE;
}

export function resolveUiLogView(raw: ConfigFileV1 | undefined, mode: UiLogMode): UiLogView {
  const env =
    normalizeUiLogView(process.env.SALMONLOOP_UI_LOG_VIEW) ??
    normalizeUiLogView(process.env.SALMONLOOP_UI_LOG) ??
    normalizeUiLogView(process.env.SALMONLOOP_UI_DENSITY);
  if (env) return env;

  const cfg = normalizeUiLogView(raw?.ui?.log?.view);
  if (cfg) return cfg;

  if (mode === 'quiet') return 'compact';
  if (mode === 'debug') return 'full';
  return DEFAULT_UI_LOG_VIEW;
}
