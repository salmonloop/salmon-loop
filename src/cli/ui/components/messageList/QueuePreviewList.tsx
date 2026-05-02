import { Box, Text } from 'ink';
import React from 'react';

import type { QueueMessage } from '../../store/types.js';
import { COLORS } from '../../styles/theme.js';

import { formatQueuePreview, orderQueueMessages } from './messageListLayout.js';

export const QueuePreviewList = React.memo<{ queueMessages: QueueMessage[] }>(
  ({ queueMessages }) => {
    const orderedQueueMessages = React.useMemo(
      () => orderQueueMessages(queueMessages),
      [queueMessages],
    );

    if (orderedQueueMessages.length === 0) return null;

    return (
      <>
        {orderedQueueMessages.map((msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={0}>
            <Text color={COLORS.text.muted} dimColor>
              {formatQueuePreview(msg.content)}
            </Text>
          </Box>
        ))}
      </>
    );
  },
);
