import { Box, Text, useStdout } from 'ink';
import BigTextOriginal from 'ink-big-text';
const BigText = BigTextOriginal as any;
import GradientOriginal from 'ink-gradient';
const Gradient = GradientOriginal as any;
const Markdown = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
import Spinner from 'ink-spinner';
import React, { useState, useEffect } from 'react';

import { text as cliText } from '../locales/index.js';

import { AutocompleteInput } from './components/AutocompleteInput.js';
import { useCommandLifecycle } from './hooks/useCommandLifecycle.js';
import { useLoopState } from './hooks/useLoopState.js';

interface AppProps {
  mode: 'run' | 'chat';
  onStart: (emit: any, options: { signal: AbortSignal }) => void;
  onChatInput?: (input: string, emit: any, options: { signal: AbortSignal }) => void;
  initialLogs?: any[];
}

export const App: React.FC<AppProps> = ({ mode, onStart, onChatInput, initialLogs = [] }) => {
  const { state, handleEvent } = useLoopState();
  const [query, setQuery] = useState('');
  const { stdout } = useStdout();

  // 1. 使用高度封装的命令生命周期 Hook
  const { signal, isExiting, renewSignal } = useCommandLifecycle(state.status, () => {
    process.exit(0);
  });

  const columns = stdout?.columns || 80;
  const isSidebarVisible = columns >= 100;

  useEffect(() => {
    if (mode === 'run') {
      onStart(handleEvent, { signal });
    }
  }, []);

  const handleSubmit = (value: string) => {
    if (onChatInput && value.trim() && state.status !== 'running') {
      // 开启新任务前刷新信号管道
      const freshSignal = renewSignal();
      onChatInput(value, handleEvent, { signal: freshSignal });
      setQuery('');
    }
  };

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24} paddingX={1}>
      {/* 🟢 主内容区 */}
      <Box flexGrow={1} flexDirection="row" marginTop={1}>
        {/* 1️⃣ 左侧主区：可滚动的 Markdown 内容 */}
        <Box flexGrow={1} flexDirection="column" paddingRight={isSidebarVisible ? 2 : 0}>
          <Box flexGrow={1} flexDirection="column">
            {(state.logs.length > 0 ? state.logs : initialLogs).slice(-20).map((log: any) => (
              <Box key={log.id} flexDirection="column" marginBottom={1}>
                {log.id === 'welcome' ? (
                  <Box flexDirection="column" marginBottom={1}>
                    <Gradient name="retro">
                      <BigText text="Salmon Loop" font="tiny" />
                    </Gradient>
                    <Markdown>{log.message}</Markdown>
                  </Box>
                ) : (
                  <Box flexDirection="column">
                    <Box>
                      <Text color="gray" dimColor>
                        [{log.timestamp?.toLocaleTimeString()?.split(' ')[0] || '--'}]{' '}
                      </Text>
                    </Box>
                    <Markdown>{log.message}</Markdown>
                  </Box>
                )}
              </Box>
            ))}
          </Box>

          {/* 输入框（仅保留内边框） */}
          {mode === 'chat' && state.status !== 'running' && (
            <Box
              marginTop={1}
              paddingY={1}
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
                  🐟 {'>'}{' '}
                </Text>
              </Box>
              <AutocompleteInput
                value={query}
                onChange={setQuery}
                onSubmit={handleSubmit}
                placeholder="Type your instruction..."
              />
              <Box flexGrow={1} />
              <Text color="gray" dimColor>
                Ready ✓ [⏎ 发送]
              </Text>
            </Box>
          )}
        </Box>

        {/* 2️⃣ 右侧侧边栏（响应式） */}
        {isSidebarVisible && (
          <Box
            width={35}
            flexDirection="column"
            paddingLeft={2}
            borderStyle="single"
            borderLeft={true}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor="gray"
          >
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="white">
                📂 Workspace
              </Text>
              <Box flexDirection="column" marginTop={1}>
                <Text color="gray" dimColor>
                  {state.workspaceInfo?.path || 'Initializing...'}
                </Text>
                {state.workspaceInfo?.isShadow && (
                  <Text color="yellow" bold>
                    ⚠️ Shadow Mode
                  </Text>
                )}
              </Box>
            </Box>

            <Box
              borderStyle="classic"
              borderTop={true}
              borderBottom={false}
              borderLeft={false}
              borderRight={false}
              marginY={1}
              borderColor="gray"
            />

            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="white">
                {cliText.cli.gui.phase.toUpperCase()}
              </Text>
              <Box justifyContent="space-between" marginTop={1}>
                <Text color="cyan" bold>
                  {state.phase}
                </Text>
                {state.status === 'running' ? (
                  <Spinner type="dots" />
                ) : (
                  <Text color="green" bold>
                    OK
                  </Text>
                )}
              </Box>
            </Box>

            <Box
              borderStyle="classic"
              borderTop={true}
              borderBottom={false}
              borderLeft={false}
              borderRight={false}
              marginY={1}
              borderColor="gray"
            />

            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="white">
                📝 文件更改
              </Text>
              <Box flexDirection="column" marginTop={1}>
                <Text color="gray">
                  auth.ts <Text color="green">[+47]</Text>
                  <Text color="red">[-12]</Text>
                </Text>
                <Text color="gray">
                  User.ts <Text color="green">[+89]</Text>
                  <Text color="red">[-0]</Text>
                </Text>
              </Box>
            </Box>

            <Box flexGrow={1} />

            <Box flexDirection="column" marginBottom={1}>
              <Box justifyContent="space-between">
                <Text color="gray">Progress</Text>
                <Text color="cyan" bold>
                  {state.progress}%
                </Text>
              </Box>
              <Text color="cyan">
                {'█'.repeat(Math.floor(state.progress / 10)) +
                  '░'.repeat(10 - Math.floor(state.progress / 10))}
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* 🏁 页脚 */}
      <Box justifyContent="space-between" paddingY={0}>
        <Text color="gray" dimColor>
          {' '}
          {isExiting ? 'Shutting down...' : `⌘ + C to abort`}{' '}
        </Text>
        <Text color="gray" dimColor>
          {columns}x{process.stdout.rows}
        </Text>
      </Box>
    </Box>
  );
};
