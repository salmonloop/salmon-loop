import { Box, Text } from 'ink';
import React from 'react';

import { useUIStore } from '../../store/context.js';

export const MissionControl: React.FC = () => {
  const { state } = useUIStore();

  const maxVisible = 8;
  const visibleTasks = React.useMemo(
    () => state.missionTasks.slice(0, Math.max(0, maxVisible)),
    [state.missionTasks],
  );

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
            ))}
            {state.missionTasks.length > maxVisible && (
              <Box>
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
