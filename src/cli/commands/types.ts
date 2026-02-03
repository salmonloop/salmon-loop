import { ChatSessionManager } from '../../core/session/manager.js';

export interface CommandContext {
  emit: (event: any) => void;
  sessionManager: ChatSessionManager;
  input: string;
}

export interface CommandResult {
  action?: 'NEED_CONFIRMATION';
  message?: string;
  data?: any;
}

export interface Command {
  name: string;
  description: string;
  execute: (context: CommandContext) => Promise<CommandResult | void> | CommandResult | void;
  getSuggestions?: (
    context: CommandContext,
  ) => Promise<{ name: string; description: string }[]> | { name: string; description: string }[];
}
