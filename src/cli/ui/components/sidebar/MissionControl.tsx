import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

export const MissionControl: React.FC = () => {
  const { state } = useUIStore();

  const maxVisible = 5;
  const visibleTasks = state.missionTasks.slice(0, Math.max(0, maxVisible));

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        Mission Control
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {state.missionTasks.length === 0 ? (
          <Text color="gray" dimColor>
            No active tasks.
          </Text>
        ) : (
          <>
            {visibleTasks.map((task) => (
              <Box key={task.id} flexDirection="row">
                <Box width={4}>
                  <Text color={task.status === 'completed' ? 'gray' : 'cyan'}>
                    {task.status === 'completed' ? '[x] ' : '[ ] '}
                  </Text>
                </Box>
                <Box flexGrow={1}>
                  <Text
                    wrap="truncate"
                    color={task.status === 'completed' ? 'gray' : 'white'}
                    strikethrough={task.status === 'completed'}
                  >
                    {task.content}
                  </Text>
                </Box>
              </Box>
            ))}
            {state.missionTasks.length > maxVisible && (
              <Box flexDirection="row">
                <Box width={4}>
                  <Text> </Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color="gray" dimColor>
                    ... and {state.missionTasks.length - maxVisible} more task
                    {state.missionTasks.length - maxVisible === 1 ? '' : 's'}
                  </Text>
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
