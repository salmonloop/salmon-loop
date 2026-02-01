import { useState, useCallback } from 'react';

import { LoopEvent } from '../../../core/types.js';
import { UIState } from '../types.js';

export function useLoopState() {
  const [state, setState] = useState<UIState>({
    phase: 'IDLE',
    status: 'idle',
    logs: [
      {
        id: 'welcome',
        message: '# 🐟 Salmon Loop v0.2.0\nReady ✓ | Token: 0/10k',
        level: 'info',
        timestamp: new Date(),
      },
    ],
    progress: 0,
    history: [],
  });

  const handleEvent = useCallback((event: LoopEvent) => {
    setState((prev) => {
      switch (event.type) {
        case 'phase.start':
          return {
            ...prev,
            phase: event.phase,
            status: 'running',
          };
        case 'log':
          return {
            ...prev,
            logs: [
              ...prev.logs,
              {
                id: Math.random().toString(36).substring(7),
                message: event.message,
                level: event.level as any,
                timestamp: event.timestamp,
              },
            ].slice(-100),
          };
        case 'phase.end':
          if (event.phase === 'VERIFY' && event.success) {
            return { ...prev, status: 'success', progress: 100 };
          }
          return prev;
        case 'checkpoint.created':
          return {
            ...prev,
            logs: [
              ...prev.logs,
              {
                id: 'clear-' + Date.now(),
                message: '--- SCREEN CLEARED ---',
                level: 'info' as any,
                timestamp: new Date(),
              },
            ],
          };
        case 'workspace.ready':
          return {
            ...prev,
            workspaceInfo: {
              path: event.path,
              strategy: event.strategy,
              isShadow: event.strategy === 'worktree',
            },
          };
        default:
          return prev;
      }
    });
  }, []);

  return { state, handleEvent };
}
