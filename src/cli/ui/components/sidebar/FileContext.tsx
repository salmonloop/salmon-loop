import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

export const FileContext: React.FC = () => {
  const { state } = useUIStore();
  const maxVisible = 5;

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
          <>
            {state.changedFiles.slice(0, maxVisible).map((file) => (
              <Box key={file} flexDirection="row" flexGrow={1}>
                <Text color="yellow">M </Text>
                <Box flexGrow={1} flexDirection="row">
                  <Text color="white" wrap="truncate">
                    {file}
                  </Text>
                </Box>
              </Box>
            ))}
            {state.changedFiles.length > maxVisible && (
              <Box flexDirection="row">
                <Text color="gray" dimColor>
                  ... and {state.changedFiles.length - maxVisible} more file
                  {state.changedFiles.length - maxVisible === 1 ? '' : 's'}
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
