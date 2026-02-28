export type A2AJsonRpcRequest = {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type A2ATaskResult = {
  id: string;
  state: string;
  status?: {
    state: string;
    timestamp: string;
    message?: string;
  };
  requiredAction?: {
    type: string;
    reason?: 'approval' | 'clarification' | 'reopen';
    prompt: string;
  };
  failure?: {
    code: string;
    category?: 'verification' | 'runtime' | 'policy' | 'infrastructure';
    message: string;
    retryable?: boolean;
  };
  artifacts?: Array<{
    artifactId: string;
    name: string;
    kind: string;
    mimeType?: string;
    content?: string;
    delivery?: 'inline' | 'handle' | 'url';
    handle?: string;
    url?: string;
    expiresAt?: string;
  }>;
  metadata?: {
    capability?: string;
    tenantId?: string;
    attempt?: number;
  };
  events?: Array<{
    id?: string;
    type: string;
    taskId: string;
    state?: string;
    attempt?: number;
    failure?: { category?: string; code?: string };
    requiredAction?: { type: string; reason?: string };
  }>;
};

export type A2AOutboundAction =
  | { action: 'start'; requestId: string; instruction: string }
  | {
      action: 'get';
      requestId: string;
      taskId: string;
      sinceEventId?: string;
      replayLimit?: number;
      requireReplay?: boolean;
    }
  | { action: 'retry'; requestId: string; taskId: string }
  | { action: 'reopen'; requestId: string; taskId: string; prompt?: string }
  | {
      action: 'submitInput';
      requestId: string;
      taskId: string;
      input: { type: string; value: string };
    };
