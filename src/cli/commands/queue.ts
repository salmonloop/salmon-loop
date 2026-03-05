import { getLogger } from '../../core/facades/cli-observability.js';
import { text } from '../locales/index.js';

import type { Command } from './types.js';
import { parseSuggestionContext } from './utils.js';

export const queueCommand: Command = {
  name: '/queue',
  description: text.cli.commandQueue,
  order: 50,
  getSuggestions: ({ input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);

    if (argIndex === 1) {
      const subCommands = ['status', 'pause', 'resume', 'retry', 'clear'];
      const search = currentPrefix.toLowerCase();
      return subCommands
        .filter((s) => s.startsWith(search))
        .map((s) => ({ name: s, description: text.cli.queueSubcommandHint(s) }));
    }

    return [];
  },
  execute: ({ emit, input, queue }) => {
    if (!queue) {
      emit({
        type: 'log',
        level: 'error',
        message: text.cli.queueUnavailable,
        timestamp: new Date(),
      });
      return;
    }

    const args = input.trim().split(/\s+/).slice(1);
    const subCommand = (args[0] || 'status').toLowerCase();
    const status = queue.status();

    if (subCommand === 'status') {
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.queueStatus(
          status.pendingCount,
          status.isProcessing,
          status.isPaused,
          status.hasInterrupted,
        ),
        timestamp: new Date(),
      });
      if (status.hasInterrupted) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueInterruptedHint,
          timestamp: new Date(),
        });
      }
      return;
    }

    if (subCommand === 'pause') {
      if (status.isPaused) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueAlreadyPaused,
          timestamp: new Date(),
        });
        getLogger().audit(
          'QUEUE_PAUSE',
          { status: 'already_paused' },
          { source: 'cli', severity: 'low', scope: 'session' },
        );
        return;
      }
      queue.pause();
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.queuePaused,
        timestamp: new Date(),
      });
      getLogger().audit(
        'QUEUE_PAUSE',
        { status: 'paused' },
        { source: 'cli', severity: 'low', scope: 'session' },
      );
      return;
    }

    if (subCommand === 'resume') {
      if (!status.isPaused) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueNotPaused,
          timestamp: new Date(),
        });
        getLogger().audit(
          'QUEUE_RESUME',
          { status: 'not_paused' },
          { source: 'cli', severity: 'low', scope: 'session' },
        );
        return;
      }
      queue.resume();
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.queueResumed,
        timestamp: new Date(),
      });
      getLogger().audit(
        'QUEUE_RESUME',
        { status: 'resumed' },
        { source: 'cli', severity: 'low', scope: 'session' },
      );
      return;
    }

    if (subCommand === 'retry') {
      const retried = queue.retry();
      if (!retried) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueRetryMissing,
          timestamp: new Date(),
        });
        return;
      }
      queue.resume();
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.queueRetryQueued,
        timestamp: new Date(),
      });
      return;
    }

    if (subCommand === 'clear') {
      const cleared = queue.clear();
      emit({
        type: 'log',
        level: 'info',
        message: text.cli.queueClearedCount(cleared),
        timestamp: new Date(),
      });
      getLogger().audit(
        'QUEUE_CLEAR',
        { cleared },
        { source: 'cli', severity: 'low', scope: 'session' },
      );
      return;
    }

    emit({
      type: 'log',
      level: 'error',
      message: text.cli.queueUsage,
      timestamp: new Date(),
    });
  },
};
