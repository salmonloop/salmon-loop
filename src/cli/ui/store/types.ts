export type UIContext = 'base' | 'sidebar' | 'popover' | 'input' | 'exit-confirm';

export interface Message {
  id: string;
  type: 'user' | 'ai' | 'system' | 'welcome';
  content: string;
  timestamp: Date;
}

export interface UIState {
  contextStack: UIContext[];
  messages: Message[];
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
    challenge: string; // 目标 Hash 的前 6 位
    command: string;
    args: any;
  };
}

export type UIAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: Message }
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
  | { type: 'CLEAR_CONFIRMATION' };
