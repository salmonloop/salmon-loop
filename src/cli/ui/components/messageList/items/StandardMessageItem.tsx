import { Box, Text } from 'ink';
import React from 'react';

import type { Message } from '../../../store/types.js';
import { COLORS, MESSAGE_STYLES } from '../../../styles/theme.js';
import { Markdown } from '../../Markdown.js';
import type { MessageRenderContext } from '../types.js';
import { formatTime } from '../utils.js';

export const StandardMessageItem = React.memo<{
  msg: Message;
  ctx: MessageRenderContext;
  showSeparator: boolean;
}>(({ msg, ctx, showSeparator }) => {
  const style = MESSAGE_STYLES[msg.type] || MESSAGE_STYLES.system;
  const isMultiline = msg.content.length > 60 || msg.content.includes('\n');
  const contentIndent = msg.type === 'user' || msg.type === 'tool_result' ? 20 : 0;

  return (
    <Box flexDirection="column" paddingLeft={3} width={ctx.containerWidth}>
      <Box flexDirection="column" marginBottom={style.marginBottom}>
        <Box flexDirection="row" gap={1}>
          <Box width={9}>
            <Text color={COLORS.text.muted} dimColor={false}>
              {formatTime(msg.timestamp)}
            </Text>
          </Box>

          {style.label && (
            <Box width={8}>
              <Text color={style.inkColor} bold>
                [{style.label}]
              </Text>
            </Box>
          )}

          {msg.metadata?.toolName && (
            <Box marginRight={1}>
              <Text color="gray">({msg.metadata.toolName})</Text>
            </Box>
          )}

          {!isMultiline && (
            <Box flexGrow={1}>
              <Markdown theme={ctx.markdownTheme} mode={ctx.markdownRenderMode}>
                {msg.content}
              </Markdown>
            </Box>
          )}
        </Box>

        {isMultiline && (
          <Box paddingLeft={contentIndent}>
            <Markdown theme={ctx.markdownTheme} mode={ctx.markdownRenderMode}>
              {msg.content}
            </Markdown>
          </Box>
        )}
      </Box>

      {showSeparator && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            {ctx.separatorLine}
          </Text>
        </Box>
      )}
    </Box>
  );
});
