import { ChatSessionManager } from '../../core/session/manager.js';
import { LoopEvent } from '../../core/types.js';
import { text } from '../locales/index.js';

import { findCommand } from './registry.js';

export type DispatchResult =
  | { type: 'executed' }
  | { type: 'blocked'; reason: string }
  | { type: 'continue'; trimmedInput: string };

export class CommandDispatcher {
  async dispatch(
    input: string,
    context: { emit: (event: LoopEvent) => void; sessionManager: ChatSessionManager },
  ): Promise<DispatchResult> {
    if (!input) {
      return { type: 'continue', trimmedInput: '' };
    }

    const trimmed = input.trim();

    // 1. Try to find and execute a valid command
    const command = findCommand(trimmed);
    if (command) {
      try {
        await command.execute({
          emit: context.emit,
          sessionManager: context.sessionManager,
          input: trimmed,
        });
        return { type: 'executed' };
      } catch (_error) {
        // If command execution fails, we still consider it executed (handled),
        // but we might want to log it? The command itself usually handles errors/logging.
        // For now, assume execute() handles its own output.
        return { type: 'executed' };
      }
    }

    // 2. Safety Check: Intercept unknown commands
    // We block anything that starts with '/' to prevent accidental leakage of commands to LLM.
    // This includes typos like '/hepl' or potentially dangerous paths if misinterpreted.
    if (trimmed.startsWith('/')) {
      const firstWord = trimmed.split(/\s+/)[0];
      const message = text.cli.unknownCommand(firstWord);

      context.emit({
        type: 'log',
        level: 'error',
        message,
        timestamp: new Date(),
      });

      return { type: 'blocked', reason: message };
    }

    // 3. Allow normal text
    return { type: 'continue', trimmedInput: trimmed };
  }
}
