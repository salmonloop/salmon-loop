import { Box, Text, Static } from 'ink';
import BigTextOriginal from 'ink-big-text';
const BigText = BigTextOriginal as any;
import GradientOriginal from 'ink-gradient';
const Gradient = GradientOriginal as any;
import { marked } from 'marked';
import TerminalRendererOriginal from 'marked-terminal';
import React from 'react';

import { useUIStore } from '../store/context.js';
import { Message } from '../store/types.js';

const TerminalRenderer = TerminalRendererOriginal as any;

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer(),
});

const Markdown: React.FC<{ content: string }> = ({ content }) => {
  if (!content) return null;
  if (content === 'WELCOME_LOGO') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Gradient name="retro">
          <BigText text="Salmon Loop" font="tiny" />
        </Gradient>
        <Text dimColor>Liquid Precision CLI v0.2.0</Text>
      </Box>
    );
  }
  try {
    return <Text>{marked.parse(content) as string}</Text>;
  } catch {
    return <Text color="red">Error rendering content</Text>;
  }
};

export const MessageList: React.FC = () => {
  const { state } = useUIStore();

  return (
    <Box flexDirection="column">
      <Static items={state.messages}>
        {(msg: Message) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            {msg.id !== 'welcome' && (
              <Box justifyContent="flex-start">
                <Text color="gray" dimColor>
                  [{msg.timestamp.toLocaleTimeString()}] {msg.type.toUpperCase()}:
                </Text>
              </Box>
            )}
            <Markdown content={msg.content} />
          </Box>
        )}
      </Static>
    </Box>
  );
};
