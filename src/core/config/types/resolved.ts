import type { LlmOutputPolicy } from '../../types/index.js';

import type { ConfigFileV1, ToolAuthorizationConfig } from './config-file.js';
import type {
  AstValidationStrictness,
  LlmProviderType,
  MarkdownRenderMode,
  MarkdownTheme,
  PermissionMode,
  UiLogMode,
  UiLogView,
} from './primitives.js';

export interface ResolvedLlmPhaseOverride {
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
  model: {
    id: string;
    slot: string;
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
  routing?: {
    fallbackProviders?: string[];
    taskToModel?: Record<string, string>;
    phaseToModel?: Record<string, string>;
    phaseToProviderModel?: Record<string, ResolvedLlmPhaseOverride>;
  };
}

export interface ResolvedConfig {
  source: {
    enabled: boolean;
    path?: string;
    used: boolean;
  };
  raw?: ConfigFileV1;
  permissionMode: PermissionMode;
  server?: {
    a2a?: {
      host?: string;
      port?: number;
      tokens?: string[];
    };
    acp?: {
      sessionStore?: {
        maxEntries?: number;
        maxAgeMs?: number;
        historyMaxEntries?: number;
        lockStaleMs?: number;
        lockHeartbeatMs?: number;
      };
      checkpointManifest?: {
        lockStaleMs?: number;
        lockHeartbeatMs?: number;
      };
    };
  };
  context: {
    useTokenBudget: boolean;
    dynamicBudget: {
      enabled: boolean;
      minBudget: number;
      maxBudget: number;
      adjustmentStep: number;
      alerts: {
        truncationRateWarn: number;
        criticalDropRateWarn: number;
      };
    };
  };
  observability: {
    langfuse: {
      enabled: boolean;
      outcome: boolean;
      endpoint?: string;
      apiKey?: string;
      apiKeySource: ApiKeySource;
      sessionId?: string;
      userId?: string;
    };
    audit: {
      scope: 'repo' | 'user';
      buffer: {
        maxEvents: number;
        maxBytes: number;
        droppedWarn: number;
      };
    };
  };
  security: {
    redaction: {
      enabled: boolean;
      mark: string;
      maxDepth: number;
      keyAllowlist?: string[];
      keyDenylist?: string[];
      patterns?: string[];
      disableDefaults?: boolean;
    };
  };
  ui: {
    logView: UiLogView;
    logMode: UiLogMode;
  };
  verify: {
    command?: string;
    timeoutMs?: number;
  };
  astValidation: {
    strictness: AstValidationStrictness;
  };
  llm: ResolvedLlmProvider;
  llmOutput: LlmOutputPolicy;
  markdownTheme: MarkdownTheme;
  markdownRenderMode: MarkdownRenderMode;
  toolAuthorization: ToolAuthorizationConfig;
}
