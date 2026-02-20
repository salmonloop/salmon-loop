import { Box, Static } from 'ink';
import React from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../../core/config/types.js';
import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';

import { MessageItem } from './messageList/MessageItem.js';
import {
  computeContainerWidth,
  computeSeparatorLine,
  computeStreamingMaxLines,
} from './messageList/messageListLayout.js';
import { QueuePreviewList } from './messageList/QueuePreviewList.js';
import type { MessageRenderContext } from './messageList/types.js';

export const MessageList: React.FC<{
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
}> = ({ markdownTheme, markdownRenderMode }) => {
  const { state } = useUIStore();
  const { completedMessages, activeStreamingMessage, queueMessages } = state;
  const streamingMaxLines = React.useMemo(
    () =>
      computeStreamingMaxLines({ terminalHeight: state.terminalHeight, logMode: state.logMode }),
    [state.terminalHeight, state.logMode],
  );
  const containerWidth = React.useMemo(
    () => computeContainerWidth(state.terminalWidth),
    [state.terminalWidth],
  );
  const separatorLine = React.useMemo(() => computeSeparatorLine(containerWidth), [containerWidth]);

  const ctx: MessageRenderContext = React.useMemo(
    () => ({
      markdownTheme,
      markdownRenderMode,
      containerWidth,
      separatorLine,
      streamingMaxLines,
      logView: state.logView,
      logMode: state.logMode,
    }),
    [
      markdownTheme,
      markdownRenderMode,
      containerWidth,
      separatorLine,
      streamingMaxLines,
      state.logView,
      state.logMode,
    ],
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
      <QueuePreviewList queueMessages={queueMessages} />
    </Box>
  );
};
