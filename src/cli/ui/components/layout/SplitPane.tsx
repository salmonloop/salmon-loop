import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
}

export const SplitPane: React.FC<SplitPaneProps> = ({ left, right }) => {
  const { state } = useUIStore();
  const { terminalWidth, isSidebarVisible } = state;

  const isDesktop = terminalWidth >= 120;
  const showSidebar = isSidebarVisible && isDesktop;

  return (
    <Box flexDirection="row" flexGrow={1} width="100%">
      {/* Main Chat Area */}
      <Box
        flexDirection="column"
        flexGrow={showSidebar ? 0.75 : 1}
        flexBasis={showSidebar ? '75%' : '100%'}
        paddingRight={showSidebar ? 1 : 0}
      >
        {left}
      </Box>

      {/* Sidebar Area */}
      {showSidebar && (
        <Box flexDirection="column" flexGrow={0.25} flexBasis="25%" paddingLeft={1}>
          {/* Airy Border: Only a vertical dash or whitespace */}
          <Box position="absolute" marginLeft={-1}>
            <Text color="gray" dimColor>
              ┊
            </Text>
          </Box>
          {right}
        </Box>
      )}
    </Box>
  );
};
