import { Box, Text, useInput } from 'ink';
import BigTextOriginal from 'ink-big-text';
import GradientOriginal from 'ink-gradient';
import React, { useEffect, useState } from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../../core/config/types.js';
import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';
import { Message, QueueMessage } from '../store/types.js';

import { Markdown } from './Markdown.js';

const BigText = BigTextOriginal as any;
const Gradient = GradientOriginal as any;

const MessageItem = React.memo<{
  msg: Message;
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}>(({ msg, markdownTheme, markdownRenderMode }) => {
  // Handle Special Logo
  if (msg.content === 'WELCOME_LOGO') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Gradient name="retro">
          <BigText text="Salmon Loop" font="tiny" />
        </Gradient>
      </Box>
    );
  }

  // Handle Splatted Interrupt
  if (msg.content.includes('^C [SPLATTED]')) {
    const [mainContent] = msg.content.split('^C [SPLATTED]');
    return (
      <Box flexDirection="column" marginBottom={1}>
        {msg.id !== 'welcome' && (
          <Text color="gray" dimColor>
            [{msg.timestamp.toLocaleTimeString()}] {msg.type.toUpperCase()}:
          </Text>
        )}
        <Box paddingLeft={msg.id === 'welcome' ? 0 : 2} flexDirection="column">
          <Markdown theme={markdownTheme} mode={markdownRenderMode}>
            {mainContent}
          </Markdown>
          <Text color="red" bold>
            ^C [SPLATTED]
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={msg.type === 'system' ? 0 : 1}>
      {msg.id !== 'welcome' && (
        <Text color="gray" dimColor>
          [{msg.timestamp.toLocaleTimeString()}] {msg.type.toUpperCase()}:
        </Text>
      )}
      <Box paddingLeft={msg.id === 'welcome' ? 0 : 2}>
        <Markdown theme={markdownTheme} mode={markdownRenderMode}>
          {msg.content}
        </Markdown>
      </Box>
    </Box>
  );
});

export const MessageList: React.FC<{
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}> = ({ markdownTheme, markdownRenderMode }) => {
  const { state } = useUIStore();
  const { messages, queueMessages } = state;
  const [isAnchored, setIsAnchored] = useState(true);

  // Limit rendered messages to the last 50 to prevent performance degradation
  const displayMessages = messages.slice(-50);

  // Scroll intent detection
  useInput((_input, key) => {
    if (key.upArrow || key.pageUp) {
      setIsAnchored(false);
    }
    if (key.downArrow || key.pageDown || key.return) {
      setIsAnchored(true);
    }
  });

  // Tracking new messages when not anchored
  useEffect(() => {
    if (!isAnchored && messages.length > 0) {
      // Logic for new message notification could go here
    }
  }, [messages.length, isAnchored]);

  const truncateQueueContent = (content: string) => {
    const singleLine = content.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= UI_CONFIG.QUEUE_PREVIEW_MAX_CHARS) return singleLine;
    return singleLine.slice(0, UI_CONFIG.QUEUE_PREVIEW_MAX_CHARS - 3) + '...';
  };

  const orderedQueueMessages: QueueMessage[] = [...queueMessages].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayMessages.map((msg) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          markdownTheme={markdownTheme}
          markdownRenderMode={markdownRenderMode}
        />
      ))}
      {orderedQueueMessages.map((msg) => (
        <Box key={msg.id} flexDirection="column" marginBottom={0}>
          <Text color="gray" dimColor>
            {truncateQueueContent(msg.content)}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
