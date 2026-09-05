import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

export const MissionControl: React.FC = () => {
  const { state } = useUIStore();
  const maxVisible = 5;

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
            {state.missionTasks.slice(0, maxVisible).map((task) => (
              <Box key={task.id} flexDirection="row" flexGrow={1}>
                <Text color={task.status === 'completed' ? 'gray' : 'cyan'}>
                  {task.status === 'completed' ? '[x] ' : '[ ] '}
                </Text>
                <Box flexGrow={1} flexDirection="row">
                  <Text
                    color={task.status === 'completed' ? 'gray' : 'white'}
                    strikethrough={task.status === 'completed'}
                    wrap="truncate"
                  >
                    {task.content}
                  </Text>
                </Box>
              </Box>
            ))}
            {state.missionTasks.length > maxVisible && (
              <Box flexDirection="row">
                <Text color="gray" dimColor>
                  ... and {state.missionTasks.length - maxVisible} more task
                  {state.missionTasks.length - maxVisible === 1 ? '' : 's'}
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
