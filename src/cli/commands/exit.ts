import { text } from '../locales/index.js';

import type { Command } from './types.js';

export const exitCommand: Command = {
  name: '/exit',
  description: text.cli.commandExit,
  execute: () => process.exit(0),
};

export const quitCommand: Command = {
  name: '/quit',
  description: text.cli.commandExit,
  execute: () => process.exit(0),
};
