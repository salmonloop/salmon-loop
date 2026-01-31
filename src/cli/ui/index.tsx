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
              logger.error(err instanceof Error ? err.message : String(err));
              unmount();
              resolveExit({ success: false, reason: err.message });
            });
        }
      }}
      onChatInput={(input) => {
        if (mode === 'chat') {
          runFn(() => {}, input).catch((err) => {
            logger.error(`Chat Error: ${err.message}`);
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
