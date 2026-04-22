import { FLOW_MODES, parseFlowMode } from '../../core/types/flow-mode.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

export const flowModeCommand: Command = {
  name: '/flow-mode',
  description: text.cli.commandFlowMode,
  order: 55,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    if (argIndex !== 1) return [];

    const search = currentPrefix.toLowerCase();
    return FLOW_MODES.filter((mode) => mode.startsWith(search)).map((mode) => ({
      name: mode,
      description: text.cli.flowModeSuggestion(mode),
    }));
  },
  execute: async ({ emit, input, sessionManager }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const rawValue = args[0];

    if (!rawValue) {
      const current = sessionManager.getChatFlowMode() ?? 'autopilot';
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.flowModeCurrent(current),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.flowModeUsage,
        timestamp: new Date(),
      });
      return;
    }

    const normalized = parseFlowMode(rawValue);
    if (!normalized) {
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.flowModeInvalid(rawValue),
        timestamp: new Date(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.flowModeUsage,
        timestamp: new Date(),
      });
      return;
    }

    sessionManager.updateChatFlowMode(normalized);
    await sessionManager.save();
    emit({
      type: 'log',
      level: 'info',
      message: text.cli.flowModeUpdated(normalized),
      timestamp: new Date(),
    });
  },
};
