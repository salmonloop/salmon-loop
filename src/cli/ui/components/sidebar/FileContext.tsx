import { Box, Text } from 'ink';
import React from 'react';

export const FileContext: React.FC = () => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        📂 File Context
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" dimColor>
          Searching for changes...
        </Text>
        {/* Real file change list will be wired to state.workspaceInfo */}
      </Box>
    </Box>
  );
};
