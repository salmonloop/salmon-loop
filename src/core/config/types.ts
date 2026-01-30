export type ConfigVersion = 1;

export type Verbosity = 'quiet' | 'basic' | 'verbose' | 'extended';
export type StrategyMode = 'direct' | 'worktree';

export type LlmProviderType =
  | 'openai-compatible'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | (string & {});

export interface ConfigFileV1 {
  version?: ConfigVersion;

  cli?: {
    defaults?: {
      verbosity?: Verbosity;
      strategy?: StrategyMode;
      dryRun?: boolean;
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
  verify: {
    command?: string;
    timeoutMs?: number;
  };
  llm: ResolvedLlmProvider;
}
