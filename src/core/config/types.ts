import type { LlmOutputKind, LlmOutputPolicy } from '../types/index.js';

export type ConfigVersion = 1;

export type Verbosity = 'quiet' | 'basic' | 'verbose' | 'extended';
export type StrategyMode = 'direct' | 'worktree';

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

export interface ConfigFileV1 {
  version?: ConfigVersion;

  cli?: {
    defaults?: {
      verbosity?: Verbosity;
      strategy?: StrategyMode;
      dryRun?: boolean;
    };
  };

  observability?: ObservabilityConfigV1;

  output?: {
    llm?: LlmOutputConfig;
    markdown?: {
      theme?: MarkdownTheme;
      mode?: MarkdownRenderMode;
    };
  };

  verify?: {
    command?: string;
    timeoutMs?: number;
  };

  llm?: {
    active?: string;
    providers?: Record<string, LlmProviderV1>;
    routing?: {
      fallbackProviders?: string[];
      taskToModel?: Record<string, string>;
    };
  };

  toolAuthorization?: ToolAuthorizationConfig;
}

export interface LlmOutputConfig {
  kinds?: LlmOutputKind[];
}

export interface ObservabilityConfigV1 {
  langfuse?: LangfuseObservabilityConfigV1;
}

export interface LangfuseObservabilityConfigV1 {
  /**
   * Enables Langfuse correlation headers on LLM calls (via LiteLLM pass-through).
   */
  enabled?: boolean;
  /**
   * Enables run outcome reporting (trace metadata + scores) via LiteLLM's Langfuse proxy endpoint.
   */
  outcome?: boolean;
  /**
   * Langfuse proxy endpoint base (may include a path prefix, e.g. "https://api.s8p.io/langfuse/").
   */
  endpoint?: string;
  /**
   * Optional Langfuse sessionId. If set, multiple SalmonLoop runs can be grouped into a single Langfuse Session.
   */
  sessionId?: string;
  /**
   * Optional Langfuse userId. Useful for multi-user deployments / attribution.
   */
  userId?: string;
}

export interface LlmProviderV1 {
  type: LlmProviderType;
  client?: {
    package?: string;
  };
  api?: {
    baseUrl?: string;
    apiKey?: string | null;
    timeoutMs?: number;
    headers?: Record<string, string>;
  };
  models?: Record<string, LlmModelV1>;
}

export interface LlmModelV1 {
  id: string;
  params?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  };
}

export type ApiKeySource = 'inline' | 'env' | 'missing';

export interface ResolvedLlmProvider {
  id: string;
  type: LlmProviderType;
  clientPackage?: string;
  api: {
    baseUrl?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    apiKey?: string;
    apiKeySource: ApiKeySource;
  };
  models: {
    selectedModelId: string;
    selectedModelSlot: string;
  };
}

export interface ResolvedConfig {
  source: {
    enabled: boolean;
    path?: string;
    used: boolean;
  };
  raw?: ConfigFileV1;
  observability: {
    langfuse: {
      enabled: boolean;
      outcome: boolean;
      endpoint?: string;
      sessionId?: string;
      userId?: string;
    };
  };
  verify: {
    command?: string;
    timeoutMs?: number;
  };
  llm: ResolvedLlmProvider;
  llmOutput: LlmOutputPolicy;
  markdownTheme: MarkdownTheme;
  markdownRenderMode: MarkdownRenderMode;
  toolAuthorization: ToolAuthorizationConfig;
}

export interface ToolAuthorizationConfig {
  sessionTtlMs?: number;
  autoAllowRisk?: {
    low?: boolean;
    medium?: boolean;
    high?: boolean;
  };
  allowlist?: {
    repoFile?: string;
    userFile?: string;
    summary?: {
      every?: number;
      minIntervalMs?: number;
      failureMinIntervalMs?: number;
      maxToolStats?: number;
      maxPathStats?: number;
    };
    matching?: {
      denySideEffects?: 'any' | 'all';
      allowSideEffects?: 'any' | 'all';
    };
  };
}
