import { useStdout, Box, Text } from 'ink';
import React, { useEffect } from 'react';

import { ThinkingWave } from './components/animations/ThinkingWave.js';
import { AutocompleteInput } from './components/AutocompleteInput.js';
import { SplitPane } from './components/layout/SplitPane.js';
import { MessageList } from './components/MessageList.js';
import { FileContext } from './components/sidebar/FileContext.js';
import { MissionControl } from './components/sidebar/MissionControl.js';
import { useCommandLifecycle } from './hooks/useCommandLifecycle.js';
import { useOnionExit } from './hooks/useOnionExit.js';
import { UIStoreProvider, useUIStore } from './store/context.js';

const AppCore: React.FC<{ mode: 'run' | 'chat'; onStart: any; onChatInput?: any }> = ({
  mode,
  onStart,
  onChatInput,
}) => {
  const { state, dispatch } = useUIStore();
  const { stdout } = useStdout();
  const { isExitConfirming } = useOnionExit();

  // Handle terminal resizing
  useEffect(() => {
    const handleResize = () => {
      dispatch({
        type: 'UPDATE_DIMENSIONS',
        payload: { width: stdout?.columns || 100, height: stdout?.rows || 30 },
      });
    };
    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout, dispatch]);

  const { signal } = useCommandLifecycle(state.currentPhase as any, () => process.exit(0));

  useEffect(() => {
    if (mode === 'run') {
      onStart(
        (event: any) => {
          switch (event.type) {
            case 'log':
              dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                  id: Math.random().toString(),
                  type: 'system',
                  content: event.message,
                  timestamp: new Date(),
                },
              });
              break;
            case 'phase.start':
              dispatch({ type: 'UPDATE_PHASE', payload: event.phase, status: 'running' });
              break;
            case 'workspace.ready':
              dispatch({
                type: 'UPDATE_WORKSPACE',
                payload: { path: event.path, isShadow: event.strategy === 'worktree' },
              });
              break;
          }
        },
        { signal },
      );
    }
  }, [mode, onStart, dispatch, signal]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <SplitPane
        left={
          <Box flexDirection="column" flexGrow={1}>
            <MessageList />

            {state.isThinking && (
              <Box paddingY={1}>
                <ThinkingWave />
                <Text color="gray"> Processing flow...</Text>
              </Box>
            )}

            <Box
              marginTop={1}
              borderStyle="classic"
              borderTop={true}
              borderColor="gray"
              paddingY={1}
            >
              <Box marginRight={1}>
                <Text color="cyan" bold>
                  {' '}
                  🐟 {'>'}{' '}
                </Text>
              </Box>
              <AutocompleteInput
                value={state.inputContent}
                onChange={(val) => dispatch({ type: 'SET_INPUT', payload: val })}
                onSubmit={(val) => {
                  if (onChatInput && val.trim()) {
                    onChatInput(
                      val,
                      (ev: any) =>
                        dispatch({
                          type: 'ADD_MESSAGE',
                          payload: {
                            ...ev,
                            id: ev.id || Math.random().toString(36).substring(2, 11),
                            timestamp: ev.timestamp || new Date(),
                          },
                        }),
                      {
                        signal: new AbortController().signal,
                      },
                    );
                    dispatch({ type: 'SET_INPUT', payload: '' });
                  }
                }}
                placeholder="Type your instruction..."
              />
            </Box>
          </Box>
        }
        right={
          <Box flexDirection="column">
            <FileContext />
            <Box marginY={1} borderStyle="single" borderTop={true} borderColor="dim" />
            <MissionControl />
          </Box>
        }
      />

      <Box
        justifyContent="space-between"
        paddingY={0}
        borderStyle="classic"
        borderTop={true}
        borderColor="dim"
      >
        <Text color="gray" dimColor>
          {isExitConfirming ? 'Exit Salmonloop? (y/N)' : 'Press ESC to back'}
        </Text>
        <Text color="gray" dimColor>
          {state.terminalWidth}x{state.terminalHeight}
        </Text>
      </Box>
    </Box>
  );
};

export const App: React.FC<any> = (props) => (
  <UIStoreProvider>
    <AppCore {...props} />
  </UIStoreProvider>
);
