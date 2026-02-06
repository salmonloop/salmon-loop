import { text } from '../locales/index.js';

import type { Command } from './types.js';

export const exitCommand: Command = {
  name: '/exit',
  aliases: ['/quit'],
  description: text.cli.commandExit,
  order: 10,
  execute: () => process.exit(0),
};
