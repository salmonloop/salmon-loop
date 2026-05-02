import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';
import { COLORS } from '../../styles/theme.js';

export const FileContext: React.FC = () => {
  const { state } = useUIStore();

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.text.primary}>
        File Context
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {state.changedFiles.length === 0 ? (
          <Text color={COLORS.text.muted} dimColor>
            No changes detected.
          </Text>
        ) : (
          state.changedFiles.map((file) => (
            <Box key={file}>
              <Text color={COLORS.semantic.yellow}>M </Text>
              <Text color={COLORS.text.primary}>{file}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
