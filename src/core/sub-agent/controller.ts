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

export class SubAgentController {
  private static readonly agents = new Map<string, SubAgentView>();

  static registerAgent(id: string, profile: SubAgentProfile, status: SubAgentStatus) {
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

  static updateStatus(id: string, status: SubAgentStatus, summary?: string) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.status = status;
    agent.updatedAt = new Date();
    if (summary) agent.summary = summary;
    this.appendLog(id, `Status -> ${status}${summary ? ` (${summary})` : ''}`);
  }

  static appendLog(id: string, message: string) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.logs.push(`${new Date().toISOString()} ${message}`);
    if (agent.logs.length > LOG_HISTORY_LIMIT) {
      agent.logs.splice(0, agent.logs.length - LOG_HISTORY_LIMIT);
    }
  }

  static listAgents(): SubAgentView[] {
    return Array.from(this.agents.values());
  }

  static getAgent(id: string): SubAgentView | undefined {
    return this.agents.get(id);
  }

  static tailLogs(id: string, count: number): string[] {
    const agent = this.agents.get(id);
    if (!agent) return [];
    return agent.logs.slice(-count);
  }

  static requestStop(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    if (agent.stopRequested) return true;
    agent.stopRequested = true;
    this.appendLog(id, 'Stop requested via CLI');
    return true;
  }

  static isStopRequested(id: string): boolean {
    return this.agents.get(id)?.stopRequested ?? false;
  }
}
