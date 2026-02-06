import { text } from '../locales/index.js';

import type { Command } from './types.js';

export const newCommand: Command = {
  name: '/new',
  description: text.cli.commandClear,
  order: 10,
  execute: async ({ emit, sessionManager, dispatch }) => {
    const session = await sessionManager.create();
    dispatch({ type: 'RESET_MESSAGES' });
    emit({ type: 'checkpoint.created', worktreePath: '', baseRef: '', timestamp: new Date() });
    emit({
      type: 'log',
      level: 'info',
      message: `🚀 ${text.cli.chatNewSession(session.meta.id.slice(0, 8))}`,
      timestamp: new Date(),
    });
  },
};
