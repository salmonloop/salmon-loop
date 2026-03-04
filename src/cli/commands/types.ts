import type { ToolAuthorizationConfig } from '../../core/config/types.js';
import { ChatSessionManager } from '../../core/session/manager.js';
import type { LlmOutputPolicy } from '../../core/types/llm.js';

export interface CommandContext {
  emit: (event: any) => void;
  sessionManager: ChatSessionManager;
  input: string;
  dispatch: (action: any) => void;
  queue?: QueueController;
  toolAuthorization?: ToolAuthorizationConfig;
  getLlmOutputPolicy?: () => LlmOutputPolicy | undefined;
  setLlmOutputPolicy?: (policy: LlmOutputPolicy) => void;
  signal?: AbortSignal;
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
  ) =>
    | Promise<{ name: string; description: string; command?: Command }[]>
    | { name: string; description: string; command?: Command }[];
  aliases?: string[];
  hidden?: boolean;
  order?: number;
  subcommands?: Command[];
  usage?: string;
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
  clear: () => number;
  retry: () => boolean;
  status: () => QueueStatus;
}
