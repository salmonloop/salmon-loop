import type { MarkdownRenderMode, MarkdownTheme } from '../../../../core/config/types.js';

export interface MessageRenderContext {
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
  containerWidth: number;
  separatorLine: string;
  streamingMaxLines: number;
}
