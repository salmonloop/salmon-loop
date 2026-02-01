import { Box, Text, useInput } from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import React, { useState, useEffect } from 'react';

import { en as cliText } from '../../locales/en.js';

import { AutocompleteInput } from './components/AutocompleteInput.js';
import { useLoopState } from './hooks/useLoopState.js';

interface AppProps {
  mode: 'run' | 'chat';
  onStart: (emit: any, options?: any) => void;
  onChatInput?: (input: string) => void;
  initialLogs?: any[];
}

export const App: React.FC<AppProps> = ({ mode, onStart, onChatInput, initialLogs = [] }) => {
  const { state, handleEvent } = useLoopState();
  const [query, setQuery] = useState('');
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (mode === 'run') {
      onStart(handleEvent);
    }
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      setIsExiting(true);
    }
  });

  const handleSubmit = (value: string) => {
    if (onChatInput && value.trim()) {
      onChatInput(value);
      setQuery('');
    }
  };

  return (
    <Box flexDirection="column" padding={1} height={process.stdout.rows || 24}>
      {/* 🚀 Brand Header Section */}
      <Box marginBottom={0} alignItems="flex-end">
        <Gradient name="retro">
          <BigText text="Salmon Loop" font="tiny" />
        </Gradient>
        <Box marginLeft={2} marginBottom={1}>
          <Text color="gray" italic>
            v0.2.0
          </Text>
        </Box>
        <Box flexGrow={1} />
        {state.status === 'running' && (
          <Box marginBottom={1}>
            <Text color="yellow" bold>
              WORKING{' '}
            </Text>
            <Spinner type="dots" />
          </Box>
        )}
      </Box>

      {/* Main Content Area */}
      <Box flexGrow={1} borderStyle="round" borderColor="cyan" marginTop={-1}>
        {/* Left Area: Logs & Chat (Main focus) */}
        <Box width="75%" flexDirection="column" paddingX={1}>
          <Box flexGrow={1} flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">
                {' '}
                ❯ {cliText.cli.gui.recentLogs.toUpperCase()}{' '}
              </Text>
            </Box>
            <Box flexDirection="column">
              {(state.logs.length > 0 ? state.logs : initialLogs).slice(-15).map((log: any) => (
                <Box key={log.id} height={1}>
                  <Text color="gray" dimColor>
                    {log.timestamp?.toLocaleTimeString()?.split(' ')[0] || '--'}{' '}
                  </Text>
                  <Text
                    color={
                      log.level === 'error' ? 'red' : log.level === 'warn' ? 'yellow' : 'white'
                    }
                    wrap="truncate"
                  >
                    {log.message}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>

          {mode === 'chat' && (
            <Box
              marginTop={1}
              paddingTop={1}
              borderStyle="classic"
              borderTop={true}
              borderBottom={false}
              borderLeft={false}
              borderRight={false}
              borderColor="gray"
            >
              <Box marginRight={1}>
                <Text color="cyan" bold>
                  {' '}
                  ❯{' '}
                </Text>
              </Box>
              <AutocompleteInput
                value={query}
                onChange={setQuery}
                onSubmit={handleSubmit}
                placeholder="Type your instruction here..."
              />
            </Box>
          )}
        </Box>

        {/* Right Sidebar: Stats (Compact & Professional) */}
        <Box
          width="25%"
          flexDirection="column"
          paddingX={1}
          borderStyle="single"
          borderLeft={true}
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor="cyan"
        >
          <Box marginBottom={1}>
            <Text bold color="white">
              {cliText.cli.gui.phase.toUpperCase()}
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text color="cyan" bold>
              {state.phase}
            </Text>
          </Box>

          <Box
            flexDirection="column"
            paddingY={1}
            borderStyle="classic"
            borderTop={true}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
            borderColor="gray"
          >
            <Box justifyContent="space-between">
              <Text color="gray" dimColor>
                Status
              </Text>
              {state.status === 'running' ? (
                <Text color="yellow" bold>
                  RUN
                </Text>
              ) : state.status === 'success' ? (
                <Text color="green" bold>
                  OK
                </Text>
              ) : state.status === 'idle' ? (
                <Text color="gray" bold>
                  IDLE
                </Text>
              ) : (
                <Text color="red" bold>
                  ERR
                </Text>
              )}
            </Box>
          </Box>

          <Box marginTop={2} flexDirection="column">
            <Box justifyContent="space-between" marginBottom={1}>
              <Text color="gray" dimColor>
                Progress
              </Text>
              <Text color="cyan" bold>
                {state.progress}%
              </Text>
            </Box>
            <Text color="cyan">
              {'█'.repeat(Math.floor(state.progress / 10)) +
                '░'.repeat(10 - Math.floor(state.progress / 10))}
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Box paddingX={1} backgroundColor="cyan" marginBottom={1}>
              <Text color="black" bold>
                {' '}
                {mode.toUpperCase()}{' '}
              </Text>
            </Box>
            <Text color="gray" dimColor>
              s8p.io
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Footer Info */}
      <Box marginTop={0} justifyContent="space-between" paddingX={1}>
        <Text color="gray" dimColor>
          {' '}
          {isExiting ? 'Shutting down...' : `⌘ + C to abort`}{' '}
        </Text>
        <Box>
          <Text color="gray" dimColor>
            Terminal:{' '}
          </Text>
          <Text color="white" dimColor>
            {process.stdout.columns}x{process.stdout.rows}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
