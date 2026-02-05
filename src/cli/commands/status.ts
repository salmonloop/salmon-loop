import { text } from '../locales/index.js';

import type { Command } from './types.js';

export const statusCommand: Command = {
  name: '/status',
  description: text.cli.commandStatus,
  execute: ({ emit, sessionManager }) => {
    const session = sessionManager.getCurrent();
    const statusMsg = [
      `Session: ${session.meta.name}`,
      `ID: ${session.meta.id.slice(0, 8)}`,
      `Iterations: ${session.meta.totalIterations} (${session.meta.successfulIterations} ok)`,
      `Messages: ${session.messages.length}`,
    ].join(' | ');
    emit({ type: 'log', level: 'info', message: statusMsg, timestamp: new Date() });
  },
};
