import type { ToolAuthorizationConfig } from '../../core/config/types.js';
import { ChatSessionManager } from '../../core/session/manager.js';

export interface CommandContext {
  emit: (event: any) => void;
  sessionManager: ChatSessionManager;
  input: string;
  dispatch: (action: any) => void;
  queue?: QueueController;
  toolAuthorization?: ToolAuthorizationConfig;
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

export interface QueueStatus {
  pendingCount: number;
  isProcessing: boolean;
  isPaused: boolean;
  hasInterrupted: boolean;
  interruptedInput?: string;
}

export interface QueueController {
  pause: () => void;
  resume: () => void;
  clear: () => void;
  retry: () => boolean;
  status: () => QueueStatus;
}
