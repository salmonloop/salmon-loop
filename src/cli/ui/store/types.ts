export type UIContext = 'base' | 'sidebar' | 'popover' | 'input' | 'exit-confirm';

/**
 * Message types based on Figma design system
 * Supports 14 distinct message types with 3-level visual hierarchy
 */
export type MessageType =
  | 'user' // User input
  | 'assistant' // AI complete reply
  | 'assistant_stream' // AI streaming output
  | 'system' // System notification
  | 'tool_call' // Tool invocation request
  | 'tool_result' // Tool execution result
  | 'plan_step' // Planning step
  | 'thinking' // Thinking process
  | 'checkpoint' // Checkpoint event
  | 'error' // Error message
  | 'warning' // Warning
  | 'queue' // Queue message
  | 'interrupt' // Interrupt signal
  | 'welcome'; // Welcome message (special)

/**
 * Stream state for AI responses
 */
export type StreamState = 'streaming' | 'paused' | 'completed';

/**
 * Message display level for visual hierarchy
 * - emphasis: AI replies, errors (with background/border)
 * - standard: User input, tool results (normal display)
 * - lightweight: System notices, queue (minimal/gray)
 */
export type MessageLevel = 'emphasis' | 'standard' | 'lightweight';

/**
 * Get display level for a message type
 */
export function getMessageLevel(type: MessageType): MessageLevel {
  switch (type) {
    case 'assistant':
    case 'assistant_stream':
    case 'error':
    case 'warning':
      return 'emphasis';

    case 'user':
    case 'tool_result':
    case 'checkpoint':
    case 'interrupt':
    case 'thinking':
    case 'plan_step':
      return 'standard';

    case 'system':
    case 'queue':
    case 'tool_call':
    case 'welcome':
    default:
      return 'lightweight';
  }
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  metadata?: {
    toolName?: string;
    fileName?: string;
    duration?: number;
    checkpoint?: string;
    error?: string;
    [key: string]: unknown;
  };
  streamState?: StreamState;
}

// Legacy type alias for backward compatibility
export type LegacyMessageType = 'user' | 'ai' | 'system' | 'welcome';

/**
 * Convert legacy message type to new type
 */
export function normalizeLegacyType(type: string): MessageType {
  if (type === 'ai') return 'assistant';
  const validTypes = [
    'user',
    'assistant',
    'assistant_stream',
    'system',
    'tool_call',
    'tool_result',
    'plan_step',
    'thinking',
    'checkpoint',
    'error',
    'warning',
    'queue',
    'interrupt',
    'welcome',
  ];
  if (validTypes.includes(type)) {
    return type as MessageType;
  }
  return 'system';
}

export interface QueueMessage {
  id: string;
  content: string;
  timestamp: Date;
}

export interface UIState {
  contextStack: UIContext[];
  // Static component optimization: separate completed messages from active streaming
  completedMessages: Message[]; // Rendered via <Static>, native terminal scroll
  activeStreamingMessage: Message | null; // Currently streaming message (React-managed)
  messages: Message[]; // DEPRECATED: Kept for backward compatibility
  queueMessages: QueueMessage[];
  inputContent: string;
  isSidebarVisible: boolean;
  terminalWidth: number;
  terminalHeight: number;
  missionTasks: Array<{ id: string; content: string; status: 'pending' | 'completed' | 'failed' }>;
  currentPhase: string;
  isThinking: boolean;
  changedFiles: string[];
  inputHistory: string[];
  pendingConfirmation?: {
    message: string;
    challenge: string; // First 6 characters of the target hash.
    command: string;
    args: any;
  };
  pendingAuthorization?: {
    id: string;
    message: string;
    challenge: string;
  };
  pendingSelection?: {
    id: string;
    title: string;
    items: Array<{ id: string; label: string; description?: string }>;
  };
}

export type UIAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'APPEND_LLM_STREAM'; payload: { id: string; delta: string; timestamp: Date } }
  | { type: 'COMPLETE_STREAM'; payload: { id: string } } // Move active streaming message to completed
  | { type: 'ADD_QUEUE_MESSAGE'; payload: QueueMessage }
  | { type: 'SHIFT_QUEUE_MESSAGE' }
  | { type: 'REMOVE_QUEUE_MESSAGE'; payload: { id: string } }
  | { type: 'CLEAR_QUEUE_MESSAGES' }
  | { type: 'PUSH_CONTEXT'; payload: UIContext }
  | { type: 'POP_CONTEXT' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'UPDATE_DIMENSIONS'; payload: { width: number; height: number } }
  | { type: 'SET_THINKING'; payload: boolean }
  | { type: 'UPDATE_PHASE'; payload: string; status: 'idle' | 'running' | 'success' | 'failed' }
  | { type: 'UPDATE_WORKSPACE'; payload: { path: string; isShadow: boolean } }
  | { type: 'UPDATE_PROGRESS'; payload: number }
  | { type: 'UPDATE_TASK'; payload: { id: string; status: 'completed' | 'failed' } }
  | { type: 'SET_CHANGED_FILES'; payload: string[] }
  | { type: 'SET_INPUT_HISTORY'; payload: string[] }
  | { type: 'APPEND_INPUT'; payload: string }
  | { type: 'INTERRUPT_STREAM' }
  | { type: 'RESET_MESSAGES' }
  | { type: 'SET_CONFIRMATION'; payload: UIState['pendingConfirmation'] }
  | { type: 'CLEAR_CONFIRMATION' }
  | { type: 'SET_AUTHORIZATION'; payload: UIState['pendingAuthorization'] }
  | { type: 'CLEAR_AUTHORIZATION' }
  | { type: 'SET_SELECTION'; payload: UIState['pendingSelection'] }
  | { type: 'CLEAR_SELECTION' };
