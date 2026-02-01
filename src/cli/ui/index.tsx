import { render } from 'ink';
import React from 'react';

import { logger } from '../../core/logger.js';
import { LoopEvent } from '../../core/types.js';

import { App } from './App.js';

export async function startGUI(
  mode: 'run' | 'chat',
  runFn: (emit: (event: LoopEvent) => void, input?: string) => Promise<any>,
) {
  let resolveExit: (value: any) => void;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const { waitUntilExit, unmount } = render(
    <App
      mode={mode}
      onStart={(emit) => {
        if (mode === 'run') {
          runFn(emit)
            .then((result) => {
              setTimeout(() => {
                unmount();
                resolveExit(result);
              }, 1500);
            })
            .catch((err) => {
              emit({
                type: 'log',
                message: err.message,
                level: 'error',
                timestamp: new Date(),
              });
              setTimeout(() => {
                unmount();
                resolveExit({ success: false, reason: err.message });
              }, 1500);
            });
        }
      }}
      onChatInput={(input, emit) => {
        if (mode === 'chat') {
          runFn(emit, input).catch((err) => {
            emit({
              type: 'log',
              message: `Chat Error: ${err.message}`,
              level: 'error',
              timestamp: new Date(),
            });
          });
        }
      }}
    />,
  );

  // Handle process signals
  const cleanup = () => {
    unmount();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);

  const result = await Promise.race([waitUntilExit(), exitPromise]);
  process.off('SIGINT', cleanup);
  return result;
}
