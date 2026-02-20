import { UIState, UIAction } from './types.js';

export const initialState: UIState = {
  contextStack: ['base'],
  // Static component optimization: completedMessages rendered via <Static>
  completedMessages: [
    {
      id: 'welcome',
      type: 'system',
      content: 'WELCOME_LOGO',
      timestamp: new Date(),
    },
  ],
  activeStreamingMessage: null,
  queueMessages: [],
  logView: 'standard',
  logMode: 'normal',
  inputContent: '',
  isSidebarVisible: process.stdout.columns >= 120,
  terminalWidth: process.stdout.columns || 100,
  terminalHeight: process.stdout.rows || 30,
  missionTasks: [],
  currentPhase: 'idle',
  isThinking: false,
  statusBanner: undefined,
  interruptPending: undefined,
  changedFiles: [],
  inputHistory: [],
};

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, inputContent: action.payload };
    case 'SET_LOG_VIEW':
      return { ...state, logView: action.payload };
    case 'SET_LOG_MODE':
      return { ...state, logMode: action.payload };
    case 'ADD_MESSAGE':
      return {
        ...state,
        completedMessages: [...state.completedMessages, action.payload],
      };
    case 'APPEND_LLM_STREAM': {
      const { id, delta, timestamp } = action.payload;
      if (!delta) return state;

      // If active streaming message exists, accumulate delta
      if (state.activeStreamingMessage?.id === id) {
        const updatedActive = {
          ...state.activeStreamingMessage,
          content: state.activeStreamingMessage.content + delta,
        };
        return {
          ...state,
          activeStreamingMessage: updatedActive,
        };
      }

      // Avoid creating an empty streaming message from whitespace-only prelude chunks.
      // Once a stream exists, we preserve all deltas (including newlines) for correct formatting.
      if (delta.trim().length === 0) return state;

      // Create new active streaming message
      const newMessage = {
        id,
        type: 'assistant' as const,
        content: delta,
        timestamp,
        streamState: 'streaming' as const,
      };

      return {
        ...state,
        activeStreamingMessage: newMessage,
      };
    }
    case 'ADD_QUEUE_MESSAGE':
      return { ...state, queueMessages: [...state.queueMessages, action.payload] };
    case 'SHIFT_QUEUE_MESSAGE':
      return { ...state, queueMessages: state.queueMessages.slice(1) };
    case 'REMOVE_QUEUE_MESSAGE':
      return {
        ...state,
        queueMessages: state.queueMessages.filter((msg) => msg.id !== action.payload.id),
      };
    case 'CLEAR_QUEUE_MESSAGES':
      return { ...state, queueMessages: [] };
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
    case 'SET_STATUS_BANNER':
      return { ...state, statusBanner: action.payload ?? undefined };
    case 'CLEAR_STATUS_BANNER':
      if (action.payload?.source && state.statusBanner?.source !== action.payload.source) {
        return state;
      }
      return { ...state, statusBanner: undefined };
    case 'FINALIZE_INTERRUPT': {
      if (!state.interruptPending) return state;

      const interruptMessage = {
        id: `interrupt-${Date.now()}`,
        type: 'interrupt' as const,
        content: state.interruptPending.content ?? '',
        timestamp: action.payload?.timestamp ?? state.interruptPending.timestamp,
      };

      return {
        ...state,
        completedMessages: [...state.completedMessages, interruptMessage],
        interruptPending: undefined,
      };
    }
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
    case 'SET_INPUT_HISTORY':
      return { ...state, inputHistory: action.payload };
    case 'APPEND_INPUT': {
      const trimmed = action.payload.trim();
      if (!trimmed || trimmed.startsWith('/')) return state;
      // Deduplication logic
      if (
        state.inputHistory.length > 0 &&
        state.inputHistory[state.inputHistory.length - 1] === trimmed
      ) {
        return state;
      }
      return {
        ...state,
        inputHistory: [...state.inputHistory, trimmed].slice(-500),
      };
    }
    case 'COMPLETE_STREAM': {
      if (!state.activeStreamingMessage) return state;

      if (
        action.payload?.id &&
        action.payload.id !== 'flush-all' &&
        state.activeStreamingMessage.id !== action.payload.id
      ) {
        return state;
      }

      const completed = {
        ...state.activeStreamingMessage,
        streamState: 'completed' as const,
      };

      return {
        ...state,
        completedMessages: [...state.completedMessages, completed],
        activeStreamingMessage: null,
      };
    }
    case 'SET_CONFIRMATION':
      return { ...state, pendingConfirmation: action.payload };
    case 'CLEAR_CONFIRMATION':
      return { ...state, pendingConfirmation: undefined };
    case 'SET_AUTHORIZATION':
      return { ...state, pendingAuthorization: action.payload };
    case 'CLEAR_AUTHORIZATION':
      return { ...state, pendingAuthorization: undefined };
    case 'SET_SELECTION':
      return { ...state, pendingSelection: action.payload };
    case 'CLEAR_SELECTION':
      return { ...state, pendingSelection: undefined };
    case 'RESET_MESSAGES': {
      const welcomeMessage = {
        id: 'welcome',
        type: 'system' as const,
        content: 'WELCOME_LOGO',
        timestamp: new Date(),
      };
      return {
        ...state,
        completedMessages: [welcomeMessage],
        activeStreamingMessage: null,
        queueMessages: [],
        pendingAuthorization: undefined,
        pendingSelection: undefined,
      };
    }
    case 'INTERRUPT_STREAM': {
      if (state.interruptPending) {
        return {
          ...state,
          isThinking: false,
          currentPhase: 'idle',
        };
      }

      const pending = {
        content: action.payload?.content,
        timestamp: action.payload?.timestamp ?? new Date(),
      };

      if (!state.activeStreamingMessage) {
        return {
          ...state,
          interruptPending: pending,
          isThinking: false,
          currentPhase: 'idle',
        };
      }

      const interrupted = {
        ...state.activeStreamingMessage,
        streamState: 'paused' as const,
      };

      return {
        ...state,
        interruptPending: pending,
        completedMessages: [...state.completedMessages, interrupted],
        activeStreamingMessage: null,
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
