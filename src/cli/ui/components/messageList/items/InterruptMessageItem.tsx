import { Box, Text } from 'ink';
import React from 'react';

import type { MarkdownRenderMode, MarkdownTheme } from '../../../../../core/config/types.js';
import type { Message } from '../../../store/types.js';
import { Markdown } from '../../Markdown.js';
import { formatTime } from '../utils.js';

export const InterruptMessageItem = React.memo<{
  msg: Message;
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
  containerWidth: number;
}>(({ msg, markdownTheme, markdownRenderMode, containerWidth }) => {
  const content = msg.content.replace('^C [SPLATTED]', '').trim();

  return (
    <Box flexDirection="column" marginBottom={1} width={containerWidth}>
      <Text color="gray" dimColor>
        [{formatTime(msg.timestamp)}]
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
});
