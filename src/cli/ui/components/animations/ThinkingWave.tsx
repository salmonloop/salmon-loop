import { Text } from 'ink';
import React, { useState, useEffect } from 'react';

export const ThinkingWave: React.FC = () => {
  const [frame, setFrame] = useState(0);
  const waves = ['.', 'o', 'O', 'o'];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % waves.length);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="cyan" bold>
      {waves[frame]}
      {waves[(frame + 1) % waves.length]}
      {waves[(frame + 2) % waves.length]}
    </Text>
  );
};
