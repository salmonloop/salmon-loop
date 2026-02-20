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
  const isStep = msg.type.endsWith('_step');
  const showTimestamp = ctx.density === 'verbose' || (!isStep && ctx.density !== 'dense');
  const showLabel =
    ctx.density === 'verbose' || !(msg.type === 'tool_result' && msg.metadata?.toolName);
  const multilineIndent =
    ctx.density === 'verbose'
      ? msg.type === 'user' || msg.type === 'tool_result'
        ? 20
        : 0
      : ctx.density === 'normal'
        ? 2
        : 0;
  const leftPad = ctx.density === 'dense' ? 1 : ctx.density === 'normal' ? 2 : 3;

  return (
    <Box flexDirection="column" paddingLeft={leftPad} width={ctx.containerWidth}>
      <Box flexDirection="column" marginBottom={style.marginBottom}>
        <Box flexDirection="row" gap={1}>
          {showTimestamp && (
            <Box width={9}>
              <Text color={COLORS.text.muted} dimColor={false}>
                {formatTime(msg.timestamp)}
              </Text>
            </Box>
          )}

          {showLabel && style.label && (
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
          <Box paddingLeft={multilineIndent}>
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
