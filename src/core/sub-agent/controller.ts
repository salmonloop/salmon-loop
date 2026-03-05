import { SubAgentProfile, SubAgentStatus } from './types.js';

const LOG_HISTORY_LIMIT = 50;

export interface SubAgentView {
  id: string;
  profile: SubAgentProfile;
  status: SubAgentStatus;
  createdAt: Date;
  updatedAt: Date;
  summary?: string;
  stopRequested: boolean;
  logs: string[];
}

export interface SubAgentControllerPort {
  registerAgent(id: string, profile: SubAgentProfile, status: SubAgentStatus): void;
  updateStatus(id: string, status: SubAgentStatus, summary?: string): void;
  appendLog(id: string, message: string): void;
  listAgents(): SubAgentView[];
  getAgent(id: string): SubAgentView | undefined;
  tailLogs(id: string, count: number): string[];
  requestStop(id: string): boolean;
  isStopRequested(id: string): boolean;
}

export class InMemorySubAgentController implements SubAgentControllerPort {
  private readonly agents = new Map<string, SubAgentView>();

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
}

export function createSubAgentController(): SubAgentControllerPort {
  return new InMemorySubAgentController();
}
