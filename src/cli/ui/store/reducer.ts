import { UIState, UIAction } from './types.js';

export const initialState: UIState = {
  contextStack: ['base'],
  messages: [],
  inputContent: '',
  isSidebarVisible: process.stdout.columns >= 120,
  terminalWidth: process.stdout.columns || 100,
  terminalHeight: process.stdout.rows || 30,
  missionTasks: [],
  currentPhase: 'idle',
  isThinking: false,
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
        isSidebarVisible: action.payload.width >= 120 ? state.isSidebarVisible : false,
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
            id: 'ws',
            content: `Workspace initialized at ${action.payload.path}`,
            status: 'completed',
          },
        ],
      };
    case 'UPDATE_PROGRESS':
      return { ...state, terminalHeight: action.payload }; // Borrowing field for brief test
    default:
      return state;
  }
}
