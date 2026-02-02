import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
}

export const SplitPane: React.FC<SplitPaneProps> = ({ left, right }) => {
  const { state } = useUIStore();
  const { isSidebarVisible } = state;

  const isDesktop = true;
  const showSidebar = isSidebarVisible && isDesktop;

  return (
    <Box flexDirection="row" flexGrow={1} width="100%" alignItems="flex-end">
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
        <>
          {/* Vertical Divider: No absolute positioning to avoid ghosting */}
          <Box paddingX={1} flexShrink={0}>
            <Text color="gray" dimColor>
              ┊
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={0.25} flexBasis="25%">
            {right}
          </Box>
        </>
      )}
    </Box>
  );
};
