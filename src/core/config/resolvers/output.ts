import type { ConfigFileV1, MarkdownRenderMode, MarkdownTheme } from '../types.js';
import { DEFAULT_MARKDOWN_RENDER_MODE, DEFAULT_MARKDOWN_THEME } from '../types.js';

export function resolveMarkdownTheme(raw?: ConfigFileV1): MarkdownTheme {
  return raw?.output?.markdown?.theme ?? DEFAULT_MARKDOWN_THEME;
}

export function resolveMarkdownRenderMode(raw?: ConfigFileV1): MarkdownRenderMode {
  return raw?.output?.markdown?.mode ?? DEFAULT_MARKDOWN_RENDER_MODE;
}
