import type { LlmOutputKind, LlmOutputPolicy } from '../../types/index.js';

export type ConfigVersion = 1;

export type Verbosity = 'quiet' | 'basic' | 'verbose' | 'extended';
export type StrategyMode = 'direct' | 'worktree';
export type AstValidationStrictness = 'lenient' | 'strict';
export type PermissionMode = 'interactive' | 'yolo';

export type LlmProviderType =
  | 'openai-compatible'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | (string & {});

export const MARKDOWN_THEMES = ['default', 'vivid'] as const;
export type MarkdownTheme = (typeof MARKDOWN_THEMES)[number];
export const DEFAULT_MARKDOWN_THEME: MarkdownTheme = 'default';
export const MARKDOWN_RENDER_MODES = ['enhanced', 'native'] as const;
export type MarkdownRenderMode = (typeof MARKDOWN_RENDER_MODES)[number];
export const DEFAULT_MARKDOWN_RENDER_MODE: MarkdownRenderMode = 'enhanced';

export const UI_LOG_VIEWS = ['full', 'standard', 'compact'] as const;
export type UiLogView = (typeof UI_LOG_VIEWS)[number];
export const DEFAULT_UI_LOG_VIEW: UiLogView = 'standard';

export const UI_LOG_MODES = ['quiet', 'normal', 'debug'] as const;
export type UiLogMode = (typeof UI_LOG_MODES)[number];
export const DEFAULT_UI_LOG_MODE: UiLogMode = 'normal';

export interface LlmOutputConfig {
  kinds?: LlmOutputKind[];
}

export type { LlmOutputKind, LlmOutputPolicy };
