import { ExecutionPhase } from '../../core/types.js';

export interface UIState {
  phase: ExecutionPhase | 'IDLE';
  status: 'running' | 'success' | 'failed' | 'idle';
  logs: Array<{
    id: string;
    message: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    timestamp: Date;
  }>;
  currentTask?: string;
  progress: number;
  error?: string;
  history: Array<{
    attempt: number;
    success: boolean;
    phase: string;
  }>;
}
