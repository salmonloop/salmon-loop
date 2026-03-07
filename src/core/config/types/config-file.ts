import type {
  AstValidationStrictness,
  ConfigVersion,
  LlmOutputConfig,
  LlmProviderType,
  MarkdownRenderMode,
  MarkdownTheme,
  PermissionMode,
  StrategyMode,
  UiLogMode,
  UiLogView,
  Verbosity,
} from './primitives.js';

export interface ConfigFileV1 {
  version?: ConfigVersion;
  mode?: PermissionMode;

  cli?: {
    defaults?: {
      verbosity?: Verbosity;
      strategy?: StrategyMode;
      dryRun?: boolean;
    };
  };

  server?: {
    a2a?: {
      host?: string;
      port?: number;
      tokens?: string[];
    };
    sidecar?: {
      socket?: string;
      allowConditional?: boolean;
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

  context?: {
    useTokenBudget?: boolean;
    cache?: {
      mode?: 'memory' | 'persistent';
      path?: string;
      allowedRoots?: string[];
      strict?: boolean;
      fallbackToMemoryOnFailure?: boolean;
      maxEntries?: number;
      ttlMs?: number;
      maxPayloadBytes?: number;
    };
    churn?: {
      weight?: {
        primary?: number;
        rerank?: number;
        tiebreak?: number;
      };
    };
    dynamicBudget?: {
      enabled?: boolean;
      minBudget?: number;
      maxBudget?: number;
      adjustmentStep?: number;
      alerts?: {
        truncationRateWarn?: number;
        criticalDropRateWarn?: number;
      };
    };
  };

  observability?: ObservabilityConfigV1;

  security?: {
    redaction?: {
      enabled?: boolean;
      mark?: string;
      maxDepth?: number;
      keyAllowlist?: string[];
      keyDenylist?: string[];
      patterns?: string[];
      disableDefaults?: boolean;
    };
  };

  output?: {
    llm?: LlmOutputConfig;
    markdown?: {
      theme?: MarkdownTheme;
      mode?: MarkdownRenderMode;
    };
  };

  ui?: {
    log?: {
      view?: UiLogView;
      mode?: UiLogMode;
    };
  };

  verify?: {
    command?: string;
    timeoutMs?: number;
  };

  astValidation?: {
    strictness?: AstValidationStrictness;
  };

  llm?: {
    activeModel?: string;
    providers?: Record<string, LlmProviderV1>;
    models?: Record<string, LlmModelProfileV1>;
    routing?: {
      fallbackProviders?: string[];
      taskToModel?: Record<string, string>;
      phaseToModel?: Record<string, string>;
    };
  };

  toolAuthorization?: ToolAuthorizationConfig;
}

export interface ObservabilityConfigV1 {
  langfuse?: LangfuseObservabilityConfigV1;
  audit?: {
    scope?: 'repo' | 'user';
    buffer?: {
      maxEvents?: number;
      maxBytes?: number;
      droppedWarn?: number;
    };
  };
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
   * Optional auth key for Langfuse outcome reporting via the LiteLLM proxy route.
   *
   * This must NOT reuse the active LLM provider apiKey. Configure a dedicated key for the Langfuse proxy.
   */
  apiKey?: string | null;
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
}

export interface LlmModelParamsV1 {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export interface LlmModelProfileV1 {
  provider: string | string[];
  id: string;
  params?: LlmModelParamsV1;
}

export interface ToolAuthorizationConfig {
  sessionTtlMs?: number;
  autoAllowRisk?: {
    low?: boolean;
    medium?: boolean;
    high?: boolean;
  };
  /**
   * Non-interactive authorization handler for headless/CI environments.
   *
   * This is only used when the CLI cannot prompt the user (no TTY).
   * If not configured, tool calls requiring authorization will be denied.
   */
  nonInteractive?: {
    /**
     * Strategy for non-interactive authorization.
     * - deny: always deny when a prompt would be required
     * - command: execute an external command that returns a decision JSON
     * - mcp: call an MCP tool to obtain a decision
     */
    strategy?: 'deny' | 'command' | 'mcp';
    command?: {
      /**
       * Command to execute. The ToolAuthorizationRequest is provided as JSON on stdin.
       * The command must print an AuthorizationDecision-like JSON to stdout.
       */
      cmd: string;
      timeoutMs?: number;
    };
    mcp?: {
      /**
       * MCP server name (as configured in extensions).
       */
      server: string;
      /**
       * MCP tool name on that server (not prefixed).
       */
      tool: string;
      timeoutMs?: number;
    };
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
