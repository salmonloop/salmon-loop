import { Box, Text, useInput } from 'ink';
import BigTextOriginal from 'ink-big-text';
const BigText = BigTextOriginal as any;
import GradientOriginal from 'ink-gradient';
const Gradient = GradientOriginal as any;
import { marked } from 'marked';
import TerminalRendererOriginal from 'marked-terminal';
import React, { useState, useEffect } from 'react';

import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';
import { Message, QueueMessage } from '../store/types.js';

const TerminalRenderer = TerminalRendererOriginal as any;

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer(),
});

const MessageItem = React.memo<{ msg: Message }>(({ msg }) => (
  <Box flexDirection="column" marginBottom={msg.type === 'system' ? 0 : 1}>
    {msg.id !== 'welcome' && (
      <Text color="gray" dimColor>
        [{msg.timestamp.toLocaleTimeString()}] {msg.type.toUpperCase()}:
      </Text>
    )}
    <Box paddingLeft={msg.id === 'welcome' ? 0 : 2}>
      {msg.type === 'system' && msg.content !== 'WELCOME_LOGO' ? (
        <Text color="white" dimColor>
          {msg.content}
        </Text>
      ) : (
        <Markdown content={msg.content} />
      )}
    </Box>
  </Box>
));

const Markdown = React.memo<{ content: string }>(({ content }) => {
  if (!content) return null;
  if (content === 'WELCOME_LOGO') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Gradient name="retro">
          <BigText text="Salmon Loop" font="tiny" />
        </Gradient>
      </Box>
    );
  }

  // Handle the Splat interrupt marker
  if (content.includes('^C [SPLATTED]')) {
    const [mainContent] = content.split('^C [SPLATTED]');
    try {
      return (
        <Box flexDirection="column">
          <Text>{marked.parse(mainContent) as string}</Text>
          <Text color="red" bold>
            ^C [SPLATTED]
          </Text>
        </Box>
      );
    } catch {
      return <Text color="red">Error rendering content</Text>;
    }
  }

  try {
    return <Text>{marked.parse(content) as string}</Text>;
  } catch {
    return <Text color="red">Error rendering content</Text>;
  }
});

export const MessageList: React.FC = () => {
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
        <MessageItem key={msg.id} msg={msg} />
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
