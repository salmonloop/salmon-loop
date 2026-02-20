import { z } from 'zod';

import { SubAgentController } from '../../core/sub-agent/controller.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';

const subAgentVerbSchema = z.enum(['list', 'info', 'log', 'stop']);

const tailParser = (token: string) => {
  const [key, value] = token.split('=');
  if (key !== 'tail') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(50, parsed) : undefined;
};

const formatLogLines = (lines: string[]) =>
  lines.length === 0 ? ['(no recent log entries)'] : lines;

const formatAgentRow = (agent: ReturnType<typeof SubAgentController.listAgents>[number]) =>
  `${agent.id} | ${agent.status} | ${agent.profile.role} | ${agent.summary ?? 'No summary'}`;

export const subAgentCommand: Command = {
  name: '/smallfry',
  aliases: ['/subagent', '/sub-agent'],
  order: 30,
  description: text.cli.commandSubagent,
  hidden: true,
  async getSuggestions({ input }) {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/')) return [];
    const parts = trimmed.split(/\s+/).slice(1);
    if (parts.length === 0 || !parts[0]) {
      return subAgentVerbSchema.options.map((verb) => ({
        name: verb,
        description: `sub-agent ${verb}`,
      }));
    }

    const verb = parts[0].toLowerCase();
    if (!subAgentVerbSchema.options.includes(verb as any)) {
      const search = verb;
      return subAgentVerbSchema.options
        .filter((candidate) => candidate.startsWith(search))
        .map((candidate) => ({ name: candidate, description: `sub-agent ${candidate}` }));
    }

    if (['info', 'log', 'stop'].includes(verb)) {
      const search = parts[1]?.toLowerCase() ?? '';
      return SubAgentController.listAgents()
        .filter((agent) => agent.id.toLowerCase().startsWith(search))
        .map((agent) => ({
          name: agent.id,
          description: `${agent.status} (${agent.profile.role})`,
        }));
    }

    return [];
  },
  async execute({ emit, input }) {
    const tokens = input.trim().split(/\s+/).slice(1);
    const verb = tokens[0]?.toLowerCase();

    if (!verb) {
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.subagentUsage,
        timestamp: new Date(),
      });
      return;
    }

    if (!subAgentVerbSchema.safeParse(verb).success) {
      emit({
        type: 'log',
        level: 'warn',
        message: text.cli.subagentUnknownVerb(verb),
        timestamp: new Date(),
      });
      return;
    }

    const agentIdArg = tokens[1];

    switch (verb) {
      case 'list': {
        const agents = SubAgentController.listAgents();
        const rows = agents.map(formatAgentRow);
        emit({
          type: 'log',
          level: 'info',
          message: `${text.cli.subagentListHeader}\n${rows.join('\n')}`,
          timestamp: new Date(),
        });
        return;
      }
      case 'info': {
        if (!agentIdArg) {
          emit({
            type: 'log',
            level: 'warn',
            message: text.cli.subagentMissingId('info'),
            timestamp: new Date(),
          });
          return;
        }
        const agent = SubAgentController.getAgent(agentIdArg);
        if (!agent) {
          emit({
            type: 'log',
            level: 'warn',
            message: text.cli.subagentNotFound(agentIdArg),
            timestamp: new Date(),
          });
          return;
        }
        emit({
          type: 'log',
          level: 'info',
          message: `${text.cli.subagentInfoHeader(agent.id)}\nRole: ${agent.profile.role}\nStatus: ${agent.status}\nSummary: ${agent.summary ?? 'n/a'}\nStop requested: ${agent.stopRequested ? 'yes' : 'no'}`,
          timestamp: new Date(),
        });
        return;
      }
      case 'log': {
        if (!agentIdArg) {
          emit({
            type: 'log',
            level: 'warn',
            message: text.cli.subagentMissingId('log'),
            timestamp: new Date(),
          });
          return;
        }
        const agent = SubAgentController.getAgent(agentIdArg);
        if (!agent) {
          emit({
            type: 'log',
            level: 'warn',
            message: text.cli.subagentNotFound(agentIdArg),
            timestamp: new Date(),
          });
          return;
        }
        const tailToken = tokens.find((token) => token.startsWith('tail='));
        const tail = tailToken ? (tailParser(tailToken) ?? 20) : 20;
        const lines = formatLogLines(SubAgentController.tailLogs(agentIdArg, tail));
        emit({
          type: 'log',
          level: 'info',
          message: `${text.cli.subagentLogHeader(agent.id)}\n${lines.join('\n')}`,
          timestamp: new Date(),
        });
        return;
      }
      case 'stop': {
        if (!agentIdArg) {
          emit({
            type: 'log',
            level: 'warn',
            message: text.cli.subagentMissingId('stop'),
            timestamp: new Date(),
          });
          return;
        }
        const agent = SubAgentController.getAgent(agentIdArg);
        if (!agent) {
          emit({
            type: 'log',
            level: 'warn',
            message: text.cli.subagentNotFound(agentIdArg),
            timestamp: new Date(),
          });
          return;
        }
        SubAgentController.requestStop(agentIdArg);
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.subagentStopRequested(agentIdArg),
          timestamp: new Date(),
        });
        return;
      }
      default:
        return;
    }
  },
};
