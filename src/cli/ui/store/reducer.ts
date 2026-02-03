import { UIState, UIAction } from './types.js';

export const initialState: UIState = {
  contextStack: ['base'],
  messages: [
    {
      id: 'welcome',
      type: 'system',
      content: 'WELCOME_LOGO',
      timestamp: new Date(),
    },
  ],
  inputContent: '',
  isSidebarVisible: process.stdout.columns >= 120,
  terminalWidth: process.stdout.columns || 100,
  terminalHeight: process.stdout.rows || 30,
  missionTasks: [],
  currentPhase: 'idle',
  isThinking: false,
  changedFiles: [],
};

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, inputContent: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'PUSH_CONTEXT':
      return { ...state, contextStack: [...state.contextStack, action.payload] };
    case 'POP_CONTEXT': {
      if (state.contextStack.length <= 1) return state;
      const newStack = [...state.contextStack];
      newStack.pop();
      return { ...state, contextStack: newStack };
    }
    case 'TOGGLE_SIDEBAR':
      return { ...state, isSidebarVisible: !state.isSidebarVisible };
    case 'UPDATE_DIMENSIONS':
      return {
        ...state,
        terminalWidth: action.payload.width,
        terminalHeight: action.payload.height,
        // Auto-hide sidebar if width is too small
        isSidebarVisible: action.payload.width >= 120 ? state.isSidebarVisible : true,
      };
    case 'SET_THINKING':
      return { ...state, isThinking: action.payload };
    case 'UPDATE_PHASE':
      return {
        ...state,
        currentPhase: action.payload,
        isThinking: action.status === 'running',
      };
    case 'UPDATE_WORKSPACE':
      return {
        ...state,
        missionTasks: [
          ...state.missionTasks,
          {
            id: `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            content: `Workspace initialized at ${action.payload.path}`,
            status: 'completed',
          },
        ],
      };
    case 'SET_CHANGED_FILES':
      return { ...state, changedFiles: action.payload };
    case 'SET_CONFIRMATION':
      return { ...state, pendingConfirmation: action.payload };
    case 'CLEAR_CONFIRMATION':
      return { ...state, pendingConfirmation: undefined };
    case 'INTERRUPT_STREAM': {
      if (state.messages.length === 0) {
        return { ...state, isThinking: false, currentPhase: 'idle' };
      }
      const newMessages = [...state.messages];
      const lastIndex = newMessages.length - 1;
      const lastMsg = newMessages[lastIndex];

      if (lastMsg && lastMsg.type === 'ai') {
        newMessages[lastIndex] = {
          ...lastMsg,
          content: lastMsg.content + '^C [SPLATTED]',
        };
      }
      return {
        ...state,
        messages: newMessages,
        isThinking: false,
        currentPhase: 'idle',
      };
    }
    case 'UPDATE_PROGRESS':
      return { ...state, terminalHeight: action.payload };
    default:
      return state;
  }
}
