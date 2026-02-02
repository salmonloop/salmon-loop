import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

export const MissionControl: React.FC = () => {
  const { state } = useUIStore();

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
          state.missionTasks.map((task) => (
            <Box key={task.id}>
              <Text color={task.status === 'completed' ? 'gray' : 'cyan'}>
                {task.status === 'completed' ? '[x] ' : '[ ] '}
              </Text>
              <Text
                color={task.status === 'completed' ? 'gray' : 'white'}
                strikethrough={task.status === 'completed'}
              >
                {task.content}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
