import { redactSensitiveValue } from '../../security/redaction.js';
import type { ChatOptions, LLM, LLMMessage } from '../../types/llm.js';

export interface McpSamplingContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpSamplingMessage {
  role: 'user' | 'assistant';
  content: McpSamplingContent | McpSamplingContent[];
}

export interface McpCreateMessageParams {
  messages: McpSamplingMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens: number;
  stopSequences?: string[];
  metadata?: unknown;
  [key: string]: unknown;
}

export interface McpCreateMessageResult {
  model: string;
  role: 'assistant';
  content: {
    type: 'text';
    text: string;
  };
  stopReason: 'endTurn' | 'maxTokens' | 'stopSequence' | string;
  _meta?: Record<string, unknown>;
}

export interface McpSamplingProviderOptions {
  enabled?: boolean;
  gateway?: Pick<LLM, 'chat' | 'getModelId'>;
  maxTokens?: number;
  maxDepth?: number;
}

interface McpSamplingPolicyEngine {
  decideSampling(server: string): {
    allowed: boolean;
    denyReason?: string;
    grant?: {
      kind: string;
      maxTokens: number;
      maxDepth: number;
    };
  };
}

export class McpSamplingDeniedError extends Error {
  readonly code = 'MCP_SAMPLING_DENIED';

  constructor(
    message: string,
    readonly audit: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpSamplingDeniedError';
  }
}

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_MAX_DEPTH = 6;
const SECRET_KEY_PATTERN = /(api[-_]?key|apikey|authorization|token|secret|password|cookie)/i;

function isSamplingOptions(value: unknown): value is McpSamplingProviderOptions {
  return !value || (typeof value === 'object' && !('decideSampling' in value));
}

function assertDepth(value: unknown, maxDepth: number, depth = 0): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') return;
  if (depth > maxDepth) {
    throw new McpSamplingDeniedError('MCP sampling request exceeds maxDepth.', {
      event: 'mcp.sampling.deny',
      reason: 'max_depth_exceeded',
      maxDepth,
    });
  }
  if (Array.isArray(value)) {
    for (const item of value) assertDepth(item, maxDepth, depth + 1);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    assertDepth(item, maxDepth, depth + 1);
  }
}

function contentToText(content: McpSamplingMessage['content']): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((part) => {
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      return `[unsupported MCP sampling content: ${part.type}]`;
    })
    .join('\n');
}

function toLlmMessages(params: McpCreateMessageParams): LLMMessage[] {
  const messages: LLMMessage[] = [];
  if (params.systemPrompt) {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  for (const message of params.messages) {
    messages.push({
      role: message.role,
      content: contentToText(message.content),
    });
  }
  return messages;
}

function sanitizeForAudit(
  value: unknown,
  maxDepth: number,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return redactSensitiveValue(value, { maxDepth }).value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return '[Unserializable]';
  if (depth >= maxDepth) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item, maxDepth, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitizeForAudit(item, maxDepth, depth + 1, seen),
    ]),
  );
}

export class McpSamplingProvider {
  private readonly policy?: McpSamplingPolicyEngine;
  private readonly llm?: LLM;
  private readonly enabled: boolean;
  private readonly gateway?: Pick<LLM, 'chat' | 'getModelId'>;
  private readonly maxTokens: number;
  private readonly maxDepth: number;

  constructor(options?: McpSamplingProviderOptions);
  constructor(policy: McpSamplingPolicyEngine, llm?: LLM);
  constructor(optionsOrPolicy?: McpSamplingProviderOptions | McpSamplingPolicyEngine, llm?: LLM) {
    if (isSamplingOptions(optionsOrPolicy)) {
      const options = optionsOrPolicy ?? {};
      this.enabled = options.enabled ?? false;
      this.gateway = options.gateway;
      this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
      this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
      return;
    }

    this.policy = optionsOrPolicy;
    this.llm = llm;
    this.enabled = false;
    this.maxTokens = DEFAULT_MAX_TOKENS;
    this.maxDepth = DEFAULT_MAX_DEPTH;
  }

  async sample(input: {
    server: string;
    prompt: string;
    maxTokens: number;
    depth: number;
  }): Promise<string> {
    if (!this.policy) throw new Error('MCP_SAMPLING_POLICY_UNAVAILABLE');
    const decision = this.policy.decideSampling(input.server);
    if (!decision.allowed || decision.grant?.kind !== 'sampling') {
      throw new Error(decision.denyReason ?? 'MCP_SAMPLING_DENIED');
    }
    if (!this.llm) throw new Error('MCP_SAMPLING_LLM_UNAVAILABLE');
    if (input.depth > decision.grant.maxDepth) throw new Error('MCP_SAMPLING_DEPTH_EXCEEDED');
    if (input.maxTokens > decision.grant.maxTokens) {
      throw new Error('MCP_SAMPLING_TOKEN_LIMIT_EXCEEDED');
    }
    const result = await this.llm.chat([{ role: 'user', content: input.prompt }] as any);
    return typeof result === 'string' ? result : String((result as any)?.content ?? '');
  }

  async createMessage(
    params: McpCreateMessageParams,
    options: { signal?: AbortSignal } = {},
  ): Promise<McpCreateMessageResult> {
    const sanitizedParams = sanitizeForAudit(params, this.maxDepth);

    if (!this.enabled) {
      throw new McpSamplingDeniedError('MCP sampling is disabled by default.', {
        event: 'mcp.sampling.deny',
        reason: 'disabled',
        request: sanitizedParams,
      });
    }

    if (!this.gateway) {
      throw new McpSamplingDeniedError('MCP sampling gateway is not configured.', {
        event: 'mcp.sampling.deny',
        reason: 'gateway_missing',
        request: sanitizedParams,
      });
    }

    assertDepth(params, this.maxDepth);

    const requestedMaxTokens = params.maxTokens;
    const effectiveMaxTokens = Math.min(requestedMaxTokens, this.maxTokens);
    const chatOptions: ChatOptions = {
      temperature: params.temperature,
      maxTokens: effectiveMaxTokens,
      stop: params.stopSequences,
      signal: options.signal,
    };
    const response = await this.gateway.chat(toLlmMessages(params), chatOptions);

    return {
      model: this.gateway.getModelId?.() ?? 'salmon-loop-host-gateway',
      role: 'assistant',
      content: {
        type: 'text',
        text: response.content,
      },
      stopReason: requestedMaxTokens > effectiveMaxTokens ? 'maxTokens' : 'endTurn',
      _meta: {
        audit: {
          event: 'mcp.sampling.createMessage',
          maxTokens: effectiveMaxTokens,
          requestedMaxTokens,
          maxDepth: this.maxDepth,
        },
      },
    };
  }
}
