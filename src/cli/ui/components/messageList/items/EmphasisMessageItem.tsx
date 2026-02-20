import { Box, Text } from 'ink';
import React from 'react';

import type { Message } from '../../../store/types.js';
import { COLORS, MESSAGE_STYLES } from '../../../styles/theme.js';
import { Markdown } from '../../Markdown.js';
import { StreamIndicator, StreamingCursor, StreamingText } from '../streaming.js';
import type { MessageRenderContext } from '../types.js';
import { formatTime } from '../utils.js';

export const EmphasisMessageItem = React.memo<{
  msg: Message;
  ctx: MessageRenderContext;
  showSeparator: boolean;
}>(({ msg, ctx, showSeparator }) => {
  const style = MESSAGE_STYLES[msg.type] || MESSAGE_STYLES.system;
  const isStreaming = msg.streamState === 'streaming';
  const timestamp = formatTime(msg.timestamp);

  const bgColor =
    msg.type === 'error'
      ? COLORS.bg.errorBg
      : msg.type === 'warning'
        ? COLORS.bg.warningBg
        : COLORS.bg.highlight;

  return (
    <Box flexDirection="column" marginBottom={1} width={ctx.containerWidth}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={style.inkColor}
        paddingLeft={1}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={bgColor}
        width={ctx.containerWidth}
      >
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

        <Box marginTop={1} marginBottom={0} paddingLeft={2}>
          {isStreaming ? (
            <Box flexDirection="column">
              <StreamingText content={msg.content} maxLines={ctx.streamingMaxLines} />
              <StreamingCursor />
            </Box>
          ) : (
            <Markdown theme={ctx.markdownTheme} mode={ctx.markdownRenderMode}>
              {msg.content}
            </Markdown>
          )}
        </Box>

        {msg.metadata?.error && (
          <Box marginTop={1}>
            <Text color="red">Error: {msg.metadata.error}</Text>
          </Box>
        )}
      </Box>

      {showSeparator && (
        <Box marginTop={0} marginBottom={0} paddingLeft={2}>
          <Text color="gray" dimColor>
            {ctx.separatorLine}
          </Text>
        </Box>
      )}
    </Box>
  );
});
