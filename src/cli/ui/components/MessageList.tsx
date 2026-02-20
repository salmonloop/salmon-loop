import { Box, Text, Static } from 'ink';
import React from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../../core/config/types.js';
import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';
import type { QueueMessage } from '../store/types.js';

import { MessageItem } from './messageList/MessageItem.js';
import type { MessageRenderContext } from './messageList/types.js';

export const MessageList: React.FC<{
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}> = ({ markdownTheme, markdownRenderMode }) => {
  const { state } = useUIStore();
  const { completedMessages, activeStreamingMessage, queueMessages } = state;
  const streamingMaxLines = React.useMemo(() => {
    const h = state.terminalHeight || UI_CONFIG.DEFAULT_HEIGHT;
    const reservedRows = 10;
    const raw = h - reservedRows;
    const min = 8;
    const max = 24;
    return Math.max(min, Math.min(max, raw));
  }, [state.terminalHeight]);
  const containerWidth = React.useMemo(() => {
    const w = state.terminalWidth || UI_CONFIG.DEFAULT_WIDTH;
    const padded = Math.max(0, w - UI_CONFIG.MESSAGE_AREA_PADDING_X * 2);
    return Math.min(w, Math.max(10, padded));
  }, [state.terminalWidth]);
  const separatorLine = React.useMemo(
    () => '─'.repeat(Math.max(10, containerWidth - 2)),
    [containerWidth],
  );

  const truncateQueueContent = (content: string) => {
    const singleLine = content.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= UI_CONFIG.QUEUE_PREVIEW_MAX_CHARS) return singleLine;
    return singleLine.slice(0, UI_CONFIG.QUEUE_PREVIEW_MAX_CHARS - 3) + '...';
  };

  const orderedQueueMessages: QueueMessage[] = React.useMemo(() => {
    return [...queueMessages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }, [queueMessages]);

  const ctx: MessageRenderContext = React.useMemo(
    () => ({
      markdownTheme,
      markdownRenderMode,
      containerWidth,
      separatorLine,
      streamingMaxLines,
    }),
    [markdownTheme, markdownRenderMode, containerWidth, separatorLine, streamingMaxLines],
  );

  return (
    <Box flexDirection="column" flexGrow={1} width={containerWidth}>
      {/* Completed messages - Static rendering for native terminal scroll */}
      <Static items={completedMessages}>
        {(msg, index) => (
          <Box key={msg.id} paddingLeft={UI_CONFIG.MESSAGE_AREA_PADDING_X}>
            <MessageItem msg={msg} nextMsg={completedMessages[index + 1]} ctx={ctx} />
          </Box>
        )}
      </Static>

      {/* Active streaming message - React real-time rendering */}
      {activeStreamingMessage && (
        <MessageItem key={activeStreamingMessage.id} msg={activeStreamingMessage} ctx={ctx} />
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
