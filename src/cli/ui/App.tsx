import { Box, Text } from 'ink';
import React from 'react';

import { getSuggestions } from '../commands/registry.js';
import { text } from '../locales/index.js';

import { StretchingThinking } from './components/animations/StretchingThinking.js';
import { AutocompleteInput } from './components/AutocompleteInput.js';
import { MessageList } from './components/MessageList.js';
import { UI_CONFIG } from './config.js';
import { useCommandLifecycle } from './hooks/useCommandLifecycle.js';
import { useLoopEvents } from './hooks/useLoopEvents.js';
import { useTerminalDimensions } from './hooks/useTerminalDimensions.js';
import { UIStoreProvider, useUIStore } from './store/context.js';

const AppCore: React.FC<{
  mode: 'run' | 'chat';
  onStart: any;
  onChatInput?: any;
  sessionManager: any;
}> = ({ mode, onStart, onChatInput, sessionManager }) => {
  const { state, dispatch } = useUIStore();

  const { signal } = useCommandLifecycle(state.currentPhase as any, () => process.exit(0));

  // Use modular hooks for environment and loop events
  useTerminalDimensions();
  const { sanitizeAndDispatch } = useLoopEvents(mode, onStart, signal);

  return (
    <Box flexDirection="column">
      {/* Message Display Area */}
      <Box
        flexGrow={1}
        flexDirection="column"
        paddingX={UI_CONFIG.MESSAGE_AREA_PADDING_X}
        paddingBottom={UI_CONFIG.MESSAGE_AREA_PADDING_BOTTOM}
      >
        <MessageList />
      </Box>

      {/* Thinking Status */}
      {state.isThinking && (
        <Box paddingX={UI_CONFIG.MESSAGE_AREA_PADDING_X} paddingY={0} flexShrink={0}>
          <StretchingThinking />
        </Box>
      )}

      {/* Input & Status Area */}
      <Box
        flexDirection="column"
        marginTop={0}
        flexShrink={0}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
      >
        <Box paddingY={1} flexDirection="row" paddingX={UI_CONFIG.INPUT_ROW_PADDING_X}>
          <Box marginRight={1}>
            <Text color="cyan" bold>
              {' '}
              {'>'}{' '}
            </Text>
          </Box>
          <AutocompleteInput
            value={state.inputContent}
            onChange={(val) => dispatch({ type: 'SET_INPUT', payload: val })}
            getSuggestions={(input) =>
              getSuggestions(input, {
                emit: (ev) => sanitizeAndDispatch(ev),
                sessionManager,
                input,
                dispatch,
              })
            }
            onSubmit={async (val) => {
              if (onChatInput && val.trim()) {
                dispatch({ type: 'SET_THINKING', payload: true });
                // Explicitly add user message to history for navigation
                dispatch({
                  type: 'ADD_MESSAGE',
                  payload: {
                    id: `user-${Date.now()}`,
                    type: 'user',
                    content: val,
                    timestamp: new Date(),
                  },
                });

                const result = await onChatInput(
                  val,
                  (ev: any) => sanitizeAndDispatch(ev),
                  {
                    signal: new AbortController().signal,
                  },
                  dispatch,
                );

                if (result?.action === 'NEED_CONFIRMATION') {
                  dispatch({ type: 'SET_CONFIRMATION', payload: result.data });
                } else {
                  dispatch({ type: 'SET_INPUT', payload: '' });
                  if (state.pendingConfirmation) {
                    dispatch({ type: 'CLEAR_CONFIRMATION' });
                  }
                }
              }
            }}
            placeholder={text.cli.gui.inputPlaceholder}
          />
        </Box>
      </Box>
    </Box>
  );
};

export const App: React.FC<any> = (props) => (
  <UIStoreProvider>
    <AppCore {...props} />
  </UIStoreProvider>
);
