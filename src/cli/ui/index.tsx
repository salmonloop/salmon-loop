import { render } from 'ink';
import React from 'react';

import { logger } from '../../core/logger.js';
import { LoopEvent } from '../../core/types.js';

import { App } from './App.js';

export interface GUIOptions {
  signal?: AbortSignal;
}

export async function startGUI(
  mode: 'run' | 'chat',
  runFn: (emit: (event: LoopEvent) => void, input?: string, options?: GUIOptions) => Promise<any>,
) {
  // Silence global logger to prevent output from interfering with Ink
  logger.setSilent(true);

  let resolveExit: (value: any) => void;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const { waitUntilExit, unmount } = render(
    <App
      mode={mode}
      onStart={(emit: (event: LoopEvent) => void, options: GUIOptions) => {
        if (mode === 'run') {
          runFn(emit, undefined, options)
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
      onChatInput={(input: string, emit: (event: LoopEvent) => void, options: GUIOptions) => {
        if (mode === 'chat') {
          runFn(emit, input, options).catch((err) => {
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
