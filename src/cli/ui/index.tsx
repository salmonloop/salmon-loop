import { render } from 'ink';
import React from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../core/config/types.js';
import { logger } from '../../core/logger.js';
import { LoopEvent } from '../../core/types.js';

import { App } from './App.js';

export interface GUIOptions {
  signal?: AbortSignal;
}

export interface UIConfig {
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}

export async function startGUI(
  mode: 'run' | 'chat',
  sessionManager: any,
  runFn: (
    emit: (event: LoopEvent) => void,
    input?: string,
    options?: GUIOptions,
    dispatch?: (action: any) => void,
  ) => Promise<any>,
  uiConfig?: UIConfig,
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
      sessionManager={sessionManager}
      markdownTheme={uiConfig?.markdownTheme}
      markdownRenderMode={uiConfig?.markdownRenderMode}
      onStart={(emit: (event: LoopEvent) => void, options: GUIOptions) => {
        if (mode === 'run') {
          emit({ type: 'run.start', mode: 'run', timestamp: new Date() });
          runFn(emit, undefined, options)
            .then((result) => {
              emit({
                type: 'run.end',
                mode: 'run',
                success: Boolean(result?.success),
                timestamp: new Date(),
              });
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
              emit({ type: 'run.end', mode: 'run', success: false, timestamp: new Date() });
              setTimeout(() => {
                unmount();
                resolveExit({ success: false, reason: err.message });
              }, 1500);
            });
        }
      }}
      onChatInput={(
        input: string,
        emit: (event: LoopEvent) => void,
        options: GUIOptions,
        dispatch?: any,
      ) => {
        if (mode === 'chat') {
          emit({ type: 'run.start', mode: 'chat', timestamp: new Date() });
          runFn(emit, input, options, dispatch)
            .then((result) => {
              emit({
                type: 'run.end',
                mode: 'chat',
                success: Boolean(result?.success),
                timestamp: new Date(),
              });
            })
            .catch((err) => {
              emit({
                type: 'log',
                message: `Chat Error: ${err.message}`,
                level: 'error',
                timestamp: new Date(),
              });
              emit({ type: 'run.end', mode: 'chat', success: false, timestamp: new Date() });
            });
        }
      }}
    />,
    {
      exitOnCtrlC: false,
      patchConsole: true,
    },
  );

  const result = await Promise.race([waitUntilExit(), exitPromise]);
  return result;
}
