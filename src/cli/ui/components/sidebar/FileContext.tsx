import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

export const FileContext: React.FC = () => {
  const { state } = useUIStore();

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        File Context
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {state.changedFiles.length === 0 ? (
          <Text color="gray" dimColor>
            No changes detected.
          </Text>
        ) : (
          state.changedFiles.map((file) => (
            <Box key={file}>
              <Text color="yellow">M </Text>
              <Text color="white">{file}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
