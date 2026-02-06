import { text } from '../locales/index.js';

import type { Command } from './types.js';

export const subAgentCommand: Command = {
  name: '/smallfry',
  aliases: ['/subagent', '/sub-agent'],
  order: 45,
  description: text.cli.commandSubagent,
  execute: ({ emit }) => {
    emit({
      type: 'log',
      level: 'info',
      message: text.cli.subagentDescription,
      timestamp: new Date(),
    });
  },
};
