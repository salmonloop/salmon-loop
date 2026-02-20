import type {
  MarkdownRenderMode,
  MarkdownTheme,
  UiLogView,
} from '../../../../core/config/types.js';

export interface MessageRenderContext {
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
  containerWidth: number;
  separatorLine: string;
  streamingMaxLines: number;
  logView: UiLogView;
}
