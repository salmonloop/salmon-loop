import { Box, Text, Static } from 'ink';
import React, { useState, useEffect } from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../../core/config/types.js';
import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';
import { Message, QueueMessage, getMessageLevel } from '../store/types.js';
import { COLORS, MESSAGE_STYLES, shouldShowSeparator } from '../styles/theme.js';

import { Markdown } from './Markdown.js';
import { WelcomeMessage } from './WelcomeMessage.js';

/**
 * Animated cursor for streaming messages
 */
const StreamingCursor = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(interval);
  }, []);
  return <Text color={COLORS.semantic.blue}>{visible ? '█' : ' '}</Text>;
};

/**
 * Animated indicator for streaming status
 */
const StreamIndicator = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => setVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, []);

  // Design uses [*] with pulsing opacity
  return <Text color={COLORS.semantic.salmon}>{visible ? '[*]' : '[ ]'}</Text>;
};

const MessageItem = React.memo<{
  msg: Message;
  nextMsg?: Message;
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}>(({ msg, nextMsg, markdownTheme, markdownRenderMode }) => {
  const timestamp = msg.timestamp.toLocaleTimeString('en-US', { hour12: false });

  // 1. Handle Special Welcome Logo
  if (msg.type === 'welcome' || msg.content === 'WELCOME_LOGO') {
    return <WelcomeMessage />;
  }

  // 2. Handle Interruptions
  if (msg.type === 'interrupt' || msg.content.includes('^C [SPLATTED]')) {
    const content = msg.content.replace('^C [SPLATTED]', '').trim();
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray" dimColor>
          [{msg.timestamp.toLocaleTimeString('en-US', { hour12: false })}]
        </Text>
        {content && (
          <Box paddingLeft={2}>
            <Markdown theme={markdownTheme} mode={markdownRenderMode}>
              {content}
            </Markdown>
          </Box>
        )}
        <Box paddingLeft={2}>
          <Text color="red" bold>
            ^C [SPLATTED]
          </Text>
        </Box>
      </Box>
    );
  }

  // 3. Main Rendering Logic based on Message Level
  const level = getMessageLevel(msg.type);
  const style = MESSAGE_STYLES[msg.type] || MESSAGE_STYLES.system;
  const isStreaming = msg.streamState === 'streaming';
  const showSeparator = shouldShowSeparator(msg.type, nextMsg?.type);

  // Level 1: Emphasis (AI Assistant, Errors)
  // Layout: Clean Left Border (No heavy box) to match Figma's sleek aesthetic
  if (level === 'emphasis') {
    const bgColor =
      msg.type === 'error'
        ? COLORS.bg.errorBg
        : msg.type === 'warning'
          ? COLORS.bg.warningBg
          : COLORS.bg.highlight;

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderLeft={true}
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={style.inkColor}
          paddingLeft={1}
          backgroundColor={bgColor}
        >
          {/* Header Row */}
          <Box marginBottom={0}>
            <Text>
              <Text color={COLORS.text.muted} dimColor={false}>
                {' '}
                {timestamp}
              </Text>
              <Text color={style.inkColor} bold>
                {' '}
                {style.label}
              </Text>
              {isStreaming && (
                <Text>
                  {' '}
                  <StreamIndicator />
                </Text>
              )}
              {msg.streamState === 'paused' && <Text color={COLORS.semantic.red}> [||]</Text>}
              <Text> </Text>
            </Text>
          </Box>

          {/* Content Row */}
          <Box marginTop={1} marginBottom={0} paddingLeft={2}>
            <Markdown theme={markdownTheme} mode={markdownRenderMode}>
              {msg.content}
            </Markdown>
            {isStreaming && <StreamingCursor />}
          </Box>

          {/* Metadata/Error Info */}
          {msg.metadata?.error && (
            <Box marginTop={1}>
              <Text color="red">Error: {msg.metadata.error}</Text>
            </Box>
          )}
        </Box>

        {/* Optional: Subtle separator for visual grouping if needed */}
        {showSeparator && (
          <Box marginTop={0} marginBottom={0} paddingLeft={2}>
            <Text color="gray" dimColor>
              {'─'.repeat(76)}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Level 2: Standard (User, Tool Results)
  // Layout: Compact header + content. If content is long, align it.
  if (level === 'standard') {
    const isMultiline = msg.content.length > 60 || msg.content.includes('\n');
    // Only indent User/Tool messages to align with metadata; others (Plan/Think) start flush
    const contentIndent = msg.type === 'user' || msg.type === 'tool_result' ? 20 : 0;

    return (
      <Box flexDirection="column" paddingLeft={3}>
        <Box flexDirection="column" marginBottom={style.marginBottom}>
          {/* Header + Inline Content (if short) */}
          <Box flexDirection="row" gap={1}>
            <Box width={9}>
              <Text color={COLORS.text.muted} dimColor={false}>
                {msg.timestamp.toLocaleTimeString('en-US', { hour12: false })}
              </Text>
            </Box>

            {style.label && (
              <Box width={8}>
                <Text color={style.inkColor} bold>
                  [{style.label}]
                </Text>
              </Box>
            )}

            {/* Tool Name Metadata */}
            {msg.metadata?.toolName && (
              <Box marginRight={1}>
                <Text color="gray">({msg.metadata.toolName})</Text>
              </Box>
            )}

            {!isMultiline && (
              <Box flexGrow={1}>
                <Markdown theme={markdownTheme} mode={markdownRenderMode}>
                  {msg.content}
                </Markdown>
              </Box>
            )}
          </Box>

          {/* Multiline Content (Indented) */}
          {isMultiline && (
            <Box paddingLeft={contentIndent}>
              <Markdown theme={markdownTheme} mode={markdownRenderMode}>
                {msg.content}
              </Markdown>
            </Box>
          )}
        </Box>
        {showSeparator && (
          <Box marginBottom={1}>
            <Text color="gray" dimColor>
              {'─'.repeat(76)}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Level 3: Lightweight (System, Queue, Thinking)
  // Layout: Single line, dim color, compact
  return (
    <Box flexDirection="column" marginBottom={style.marginBottom} paddingLeft={3}>
      <Box flexDirection="row" gap={1}>
        <Text color={COLORS.text.muted} dimColor={false}>
          {msg.timestamp.toLocaleTimeString('en-US', { hour12: false })}
        </Text>
        <Text color={COLORS.text.muted} dimColor={false}>
          {msg.content}
        </Text>
      </Box>
    </Box>
  );
});

export const MessageList: React.FC<{
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}> = ({ markdownTheme, markdownRenderMode }) => {
  const { state } = useUIStore();
  const { completedMessages, activeStreamingMessage, queueMessages } = state;

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
      {/* Completed messages - Static rendering for native terminal scroll */}
      <Static items={completedMessages}>
        {(msg, index) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            nextMsg={completedMessages[index + 1]}
            markdownTheme={markdownTheme}
            markdownRenderMode={markdownRenderMode}
          />
        )}
      </Static>

      {/* Active streaming message - React real-time rendering */}
      {activeStreamingMessage && (
        <MessageItem
          key={activeStreamingMessage.id}
          msg={activeStreamingMessage}
          markdownTheme={markdownTheme}
          markdownRenderMode={markdownRenderMode}
        />
      )}

      {/* Queue messages */}
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
