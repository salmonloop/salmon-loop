export type UIContext = 'base' | 'sidebar' | 'popover' | 'input' | 'exit-confirm';

export interface Message {
  id: string;
  type: 'user' | 'ai' | 'system' | 'welcome';
  content: string;
  timestamp: Date;
}

export interface QueueMessage {
  id: string;
  content: string;
  timestamp: Date;
}

export interface UIState {
  contextStack: UIContext[];
  messages: Message[];
  queueMessages: QueueMessage[];
  inputContent: string;
  isSidebarVisible: boolean;
  terminalWidth: number;
  terminalHeight: number;
  missionTasks: Array<{ id: string; content: string; status: 'pending' | 'completed' | 'failed' }>;
  currentPhase: string;
  isThinking: boolean;
  changedFiles: string[];
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
}

export type UIAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: Message }
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
  | { type: 'INTERRUPT_STREAM' }
  | { type: 'RESET_MESSAGES' }
  | { type: 'SET_CONFIRMATION'; payload: UIState['pendingConfirmation'] }
  | { type: 'CLEAR_CONFIRMATION' }
  | { type: 'SET_AUTHORIZATION'; payload: UIState['pendingAuthorization'] }
  | { type: 'CLEAR_AUTHORIZATION' };
