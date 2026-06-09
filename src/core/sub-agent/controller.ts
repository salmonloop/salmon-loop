import type { SubAgentProfile, SubAgentResult, SubAgentStatus } from './types.js';

const LOG_HISTORY_LIMIT = 200;

export type ToolCallEventType = 'tool.call.start' | 'tool.call.end';

export interface ToolCallEvent {
  type: ToolCallEventType;
  agentId: string;
  toolName: string;
  timestamp: number;
  durationMs?: number;
  success?: boolean;
}

export type ToolCallListener = (event: ToolCallEvent) => void;

export interface SubAgentView {
  id: string;
  profile: SubAgentProfile;
  status: SubAgentStatus;
  createdAt: Date;
  updatedAt: Date;
  summary?: string;
  stopRequested: boolean;
  logs: string[];
  tokenUsage: number;
  toolCallCount: number;
}

export interface SubAgentControllerPort {
  /** Register a new agent or update an existing one. */
  registerAgent(id: string, profile: SubAgentProfile, status: SubAgentStatus): void;
  /** Update agent status and optional summary. Appends a log entry. */
  updateStatus(id: string, status: SubAgentStatus, summary?: string): void;
  /** Append a timestamped log message for the agent. */
  appendLog(id: string, message: string): void;
  /** Add token usage to the agent's running total. */
  addTokenUsage(id: string, tokens: number): void;
  /** Record a completed tool call and notify listeners. */
  recordToolCall(id: string, toolName: string, durationMs: number, success: boolean): void;
  /** Subscribe to tool call events. Returns an unsubscribe function. */
  onToolCall(listener: ToolCallListener): () => void;
  /** List all registered agents. */
  listAgents(): SubAgentView[];
  /** Get a specific agent by ID. */
  getAgent(id: string): SubAgentView | undefined;
  /** Get the last N log entries for an agent. */
  tailLogs(id: string, count: number): string[];
  /** Request graceful stop for an agent. Returns false if agent not found. */
  requestStop(id: string): boolean;
  /** Check if stop has been requested for an agent. */
  isStopRequested(id: string): boolean;
  /** Store the result of an async agent and resolve any pending awaiters. */
  setResult(id: string, result: SubAgentResult): void;
  /** Wait for an async agent's result. Returns undefined if agent not found. */
  awaitResult(id: string, timeoutMs?: number): Promise<SubAgentResult | undefined>;
}

export class InMemorySubAgentController implements SubAgentControllerPort {
  private readonly agents = new Map<string, SubAgentView>();
  private readonly toolCallListeners = new Set<ToolCallListener>();
  private readonly results = new Map<string, SubAgentResult>();
  private readonly waiters = new Map<string, ((result: SubAgentResult) => void)[]>();

  registerAgent(id: string, profile: SubAgentProfile, status: SubAgentStatus) {
    const existing = this.agents.get(id);
    if (existing) {
      existing.status = status;
      existing.updatedAt = new Date();
      return;
    }
    this.agents.set(id, {
      id,
      profile,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
      stopRequested: false,
      logs: [],
      tokenUsage: 0,
      toolCallCount: 0,
    });
  }

  updateStatus(id: string, status: SubAgentStatus, summary?: string) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.status = status;
    agent.updatedAt = new Date();
    if (summary) agent.summary = summary;
    this.appendLog(id, `Status -> ${status}${summary ? ` (${summary})` : ''}`);
  }

  appendLog(id: string, message: string) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.logs.push(`${new Date().toISOString()} ${message}`);
    if (agent.logs.length > LOG_HISTORY_LIMIT) {
      agent.logs.splice(0, agent.logs.length - LOG_HISTORY_LIMIT);
    }
  }

  addTokenUsage(id: string, tokens: number) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.tokenUsage += tokens;
  }

  recordToolCall(id: string, toolName: string, durationMs: number, success: boolean) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.toolCallCount++;
    const event: ToolCallEvent = {
      type: 'tool.call.end',
      agentId: id,
      toolName,
      timestamp: Date.now(),
      durationMs,
      success,
    };
    for (const listener of this.toolCallListeners) {
      listener(event);
    }
  }

  onToolCall(listener: ToolCallListener): () => void {
    this.toolCallListeners.add(listener);
    return () => {
      this.toolCallListeners.delete(listener);
    };
  }

  listAgents(): SubAgentView[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): SubAgentView | undefined {
    return this.agents.get(id);
  }

  tailLogs(id: string, count: number): string[] {
    const agent = this.agents.get(id);
    if (!agent) return [];
    return agent.logs.slice(-count);
  }

  requestStop(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    if (agent.stopRequested) return true;
    agent.stopRequested = true;
    this.appendLog(id, 'Stop requested via CLI');
    return true;
  }

  isStopRequested(id: string): boolean {
    return this.agents.get(id)?.stopRequested ?? false;
  }

  setResult(id: string, result: SubAgentResult): void {
    this.results.set(id, result);
    const waiters = this.waiters.get(id);
    if (waiters) {
      for (const resolve of waiters) {
        resolve(result);
      }
      this.waiters.delete(id);
    }
  }

  async awaitResult(id: string, timeoutMs = 300_000): Promise<SubAgentResult | undefined> {
    // Check if result is already available
    const existing = this.results.get(id);
    if (existing) return existing;

    // Wait for the result with timeout
    return new Promise<SubAgentResult | undefined>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter on timeout
        const waiters = this.waiters.get(id);
        if (waiters) {
          const idx = waiters.indexOf(resolve as (result: SubAgentResult) => void);
          if (idx >= 0) waiters.splice(idx, 1);
        }
        resolve(undefined);
      }, timeoutMs);

      const waiters = this.waiters.get(id) ?? [];
      waiters.push((result: SubAgentResult) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.waiters.set(id, waiters);
    });
  }
}

export function createSubAgentController(): SubAgentControllerPort {
  return new InMemorySubAgentController();
}
