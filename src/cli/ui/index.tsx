import { render } from 'ink';
import React from 'react';

import type {
  MarkdownRenderMode,
  MarkdownTheme,
  LoopEvent,
  UiLogMode,
  UiLogView,
} from '../../core/facades/cli-ui.js';
import { logger, LoopEventReporter } from '../../core/facades/cli-ui.js';
import { text } from '../locales/index.js';

import { App } from './App.js';

const TECHNICAL_CONSOLE_PATTERN =
  /(AI_RetryError|APICallError|RetryError|Last error:|requestBodyValues|responseBody|statusCode:\s*\d+)/i;

function shouldSuppressConsole(args: any[]): boolean {
  for (const arg of args) {
    if (arg instanceof Error) return true;
    if (typeof arg === 'object' && arg !== null) return true;
    if (typeof arg === 'string' && TECHNICAL_CONSOLE_PATTERN.test(arg)) return true;
  }
  return false;
}

function sanitizeConsoleArgs(args: any[]): any[] {
  return args.map((arg) => {
    if (typeof arg === 'string') {
      const looksLikeDump =
        arg.length > 200 &&
        /(APICallError|RetryError|\[Symbol\(vercel\.ai\.error|requestBodyValues|responseBody)\b/i.test(
          arg,
        );
      return looksLikeDump ? text.errors.technicalDetailsHidden : arg;
    }
    if (typeof arg === 'object' && arg !== null) {
      const code = (arg as any).code || (arg as any).llmCode || (arg as any).name || 'Object';
      const msg = (arg as any).message || '';
      return msg ? `[${code}] ${msg}` : `[${code}]`;
    }
    return arg;
  });
}

export interface GUIOptions {
  signal?: AbortSignal;
}

export interface UIConfig {
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
  logView?: UiLogView;
  logMode?: UiLogMode;
  getSuggestions?: (
    input: string,
  ) => Promise<{ name: string; description: string; command?: any }[]>;
  findCommand?: (name: string) => any;
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
  const preReporter = logger.getReporter();
  const preSilent = logger.getSilent();
  logger.setSilent(true);

  const preConsole = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };

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
      logView={uiConfig?.logView}
      logMode={uiConfig?.logMode}
      getSuggestions={uiConfig?.getSuggestions}
      findCommand={uiConfig?.findCommand}
      onInit={(emit: (event: LoopEvent) => void, options: GUIOptions, dispatch?: any) => {
        if (mode !== 'chat') return;
        runFn(emit, undefined, options, dispatch).catch((err) => {
          emit({
            type: 'log',
            message: `Chat Init Error: ${err.message}`,
            level: 'error',
            source: 'ui.startGUI',
            timestamp: new Date(),
          });
        });
      }}
      onStart={(emit: (event: LoopEvent) => void, options: GUIOptions) => {
        if (mode === 'run') {
          // Route core logs through structured LoopEvents (GUI-safe; no stdout/stderr writes).
          logger.setReporter(new LoopEventReporter(emit, { source: 'core.logger' }));
          logger.setSilent(false);

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
                source: 'ui.startGUI',
                timestamp: new Date(),
              });
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
          // Route core logs through structured LoopEvents (GUI-safe; no stdout/stderr writes).
          logger.setReporter(new LoopEventReporter(emit, { source: 'core.logger' }));
          logger.setSilent(false);

          runFn(emit, input, options, dispatch).catch((err) => {
            emit({
              type: 'log',
              message: `Chat Error: ${err.message}`,
              level: 'error',
              source: 'ui.startGUI',
              timestamp: new Date(),
            });
          });
        }
      }}
    />,
    {
      exitOnCtrlC: false,
      patchConsole: true,
    },
  );

  // Ink's patchConsole replaces console methods; re-wrap them to prevent object dumps from leaking
  // into the UI render stream.
  const inkConsoleError = console.error.bind(console);
  const inkConsoleLog = console.log.bind(console);
  const inkConsoleWarn = console.warn.bind(console);
  console.error = (...args: any[]) => {
    if (shouldSuppressConsole(args)) return;
    inkConsoleError(...sanitizeConsoleArgs(args));
  };
  console.log = (...args: any[]) => {
    if (shouldSuppressConsole(args)) return;
    inkConsoleLog(...sanitizeConsoleArgs(args));
  };
  console.warn = (...args: any[]) => {
    if (shouldSuppressConsole(args)) return;
    inkConsoleWarn(...sanitizeConsoleArgs(args));
  };

  try {
    const result = await Promise.race([waitUntilExit(), exitPromise]);
    return result;
  } finally {
    logger.setReporter(preReporter);
    logger.setSilent(preSilent);

    console.error = preConsole.error;
    console.log = preConsole.log;
    console.warn = preConsole.warn;
  }
}
