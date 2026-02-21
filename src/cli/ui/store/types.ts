import type { UiLogMode, UiLogView } from '../../../core/config/types.js';

export type UIContext = 'base' | 'sidebar' | 'popover' | 'input' | 'exit-confirm';

export type StatusBannerSource = 'runtime' | 'lifecycle';

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
  | 'explore_step' // Exploration phase
  | 'plan_step' // Planning step
  | 'patch_step' // Patch generation phase
  | 'apply_step' // Apply phase
  | 'validate_step' // Validation phase
  | 'verify_step' // Verification phase
  | 'preflight_step' // Preflight phase
  | 'context_step' // Context phase
  | 'ast_validate_step' // AST Validation phase
  | 'rollback_step' // Rollback phase
  | 'shrink_step' // Shrink phase
  | 'review_step' // Review phase
  | 'report_step' // Report phase
  | 'analyze_issues_step' // Analyze issues phase
  | 'thinking' // Thinking process
  | 'checkpoint' // Checkpoint event
  | 'error' // Error message
  | 'warning' // Warning
  | 'queue' // Queue message
  | 'interrupt' // Interrupt signal
  | 'todo_card' // TODO summary card
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
    case 'todo_card':
      return 'emphasis';

    case 'user':
    case 'tool_result':
    case 'checkpoint':
    case 'interrupt':
    case 'thinking':
    case 'explore_step':
    case 'plan_step':
    case 'patch_step':
    case 'apply_step':
    case 'validate_step':
    case 'verify_step':
    case 'preflight_step':
    case 'context_step':
    case 'ast_validate_step':
    case 'rollback_step':
    case 'shrink_step':
    case 'review_step':
    case 'report_step':
    case 'analyze_issues_step':
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
    'explore_step',
    'plan_step',
    'patch_step',
    'apply_step',
    'validate_step',
    'verify_step',
    'preflight_step',
    'context_step',
    'ast_validate_step',
    'rollback_step',
    'shrink_step',
    'review_step',
    'report_step',
    'analyze_issues_step',
    'thinking',
    'checkpoint',
    'error',
    'warning',
    'queue',
    'interrupt',
    'todo_card',
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
  queueMessages: QueueMessage[];
  logView: UiLogView;
  logMode: UiLogMode;
  inputContent: string;
  isSidebarVisible: boolean;
  terminalWidth: number;
  terminalHeight: number;
  missionTasks: Array<{ id: string; content: string; status: 'pending' | 'completed' | 'failed' }>;
  currentPhase: string;
  isThinking: boolean;
  statusBanner?: {
    face: string;
    label?: string;
    source?: StatusBannerSource;
  };
  interruptPending?: {
    content?: string;
    timestamp: Date;
  };
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
  | { type: 'HYDRATE_TRANSCRIPT'; payload: Message[] }
  | { type: 'APPEND_LLM_STREAM'; payload: { id: string; delta: string; timestamp: Date } }
  | { type: 'COMPLETE_STREAM'; payload: { id: string } } // Move active streaming message to completed
  | { type: 'ADD_QUEUE_MESSAGE'; payload: QueueMessage }
  | { type: 'SHIFT_QUEUE_MESSAGE' }
  | { type: 'REMOVE_QUEUE_MESSAGE'; payload: { id: string } }
  | { type: 'CLEAR_QUEUE_MESSAGES' }
  | { type: 'SET_LOG_VIEW'; payload: UiLogView }
  | { type: 'SET_LOG_MODE'; payload: UiLogMode }
  | { type: 'PUSH_CONTEXT'; payload: UIContext }
  | { type: 'POP_CONTEXT' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'UPDATE_DIMENSIONS'; payload: { width: number; height: number } }
  | { type: 'SET_THINKING'; payload: boolean }
  | { type: 'SET_STATUS_BANNER'; payload: UIState['statusBanner'] }
  | { type: 'CLEAR_STATUS_BANNER'; payload?: { source?: StatusBannerSource } }
  | { type: 'FINALIZE_INTERRUPT'; payload?: { timestamp?: Date } }
  | { type: 'UPDATE_PHASE'; payload: string; status: 'idle' | 'running' | 'success' | 'failed' }
  | { type: 'UPDATE_WORKSPACE'; payload: { path: string; isShadow: boolean } }
  | { type: 'UPDATE_PROGRESS'; payload: number }
  | { type: 'UPDATE_TASK'; payload: { id: string; status: 'completed' | 'failed' } }
  | { type: 'SET_CHANGED_FILES'; payload: string[] }
  | { type: 'SET_INPUT_HISTORY'; payload: string[] }
  | { type: 'APPEND_INPUT'; payload: string }
  | { type: 'INTERRUPT_STREAM'; payload?: { content?: string; timestamp?: Date } }
  | { type: 'RESET_MESSAGES' }
  | { type: 'SET_CONFIRMATION'; payload: UIState['pendingConfirmation'] }
  | { type: 'CLEAR_CONFIRMATION' }
  | { type: 'SET_AUTHORIZATION'; payload: UIState['pendingAuthorization'] }
  | { type: 'CLEAR_AUTHORIZATION' }
  | { type: 'SET_SELECTION'; payload: UIState['pendingSelection'] }
  | { type: 'CLEAR_SELECTION' };
