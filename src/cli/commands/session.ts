import { InputHistoryManager } from '../../core/history/input-history.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

export const sessionCommand: Command = {
  name: '/session',
  description: text.cli.commandSessions,
  order: 60,
  getSuggestions: async ({ sessionManager, input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);

    // Level 1: Suggest sessions
    if (argIndex === 1) {
      const sessions = await sessionManager.listSessions();
      const search = currentPrefix.toLowerCase();
      return sessions
        .filter(
          (s) => s.id.toLowerCase().startsWith(search) || s.name.toLowerCase().includes(search),
        )
        .map((s) => ({
          name: s.id.slice(0, 8),
          description: `${s.name} (${new Date(s.updatedAt).toLocaleDateString()})`,
        }));
    }

    return [];
  },
  execute: async ({ emit, sessionManager, input, dispatch }) => {
    const args = input.trim().split(/\s+/).slice(1);
    if (args.length > 0) {
      const sessionId = args[0];
      try {
        await sessionManager.resumeSession(sessionId);
        dispatch({ type: 'RESET_MESSAGES' });
        dispatch({ type: 'SET_INPUT', payload: '' });

        const current = sessionManager.getCurrent();
        const repoPath =
          typeof current?.meta?.repoPath === 'string' && current.meta.repoPath.trim()
            ? current.meta.repoPath
            : process.cwd();

        const historyManager = new InputHistoryManager(repoPath);
        await historyManager.init();
        const inputHistory = await historyManager.load(current.meta.id);
        dispatch({ type: 'SET_INPUT_HISTORY', payload: inputHistory });

        emit({
          type: 'log',
          level: 'info',
          message: `Switched to session: ${sessionId}`,
          timestamp: new Date(),
        });
      } catch (error: any) {
        emit({
          type: 'log',
          level: 'error',
          message: `Failed to switch session: ${error.message}`,
        });
      }
      return;
    }

    const sessions = await sessionManager.listSessions();
    if (sessions.length === 0) {
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.noSessionsFound,
        timestamp: new Date(),
      });
      return;
    }
    emit({
      type: 'log',
      level: 'info',
      message: 'Type "/session " (with a space) to select a session from the interactive list.',
      timestamp: new Date(),
    });
  },
};
