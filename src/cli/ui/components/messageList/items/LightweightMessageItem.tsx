import { Box, Text } from 'ink';
import React from 'react';

import type { Message } from '../../../store/types.js';
import { COLORS, MESSAGE_STYLES } from '../../../styles/theme.js';
import type { MessageRenderContext } from '../types.js';
import { formatTime } from '../utils.js';

export const LightweightMessageItem = React.memo<{
  msg: Message;
  ctx: MessageRenderContext;
}>(({ msg, ctx }) => {
  const style = MESSAGE_STYLES[msg.type] || MESSAGE_STYLES.system;
  const showTimestamp = ctx.logView === 'full';
  const leftPad = ctx.logView === 'compact' ? 1 : ctx.logView === 'standard' ? 2 : 3;

  return (
    <Box
      flexDirection="column"
      marginBottom={style.marginBottom}
      paddingLeft={leftPad}
      width={ctx.containerWidth}
    >
      <Box flexDirection="row">
        {showTimestamp && (
          <Box width={9} flexShrink={0}>
            <Text color={COLORS.text.muted} dimColor={false}>
              {formatTime(msg.timestamp)}
            </Text>
          </Box>
        )}
        <Box paddingLeft={showTimestamp ? 1 : 0} flexGrow={1}>
          <Text color={COLORS.text.muted} dimColor={false}>
            {msg.content}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});
