import { Text } from 'ink';
import React, { useState, useEffect } from 'react';

import { COLORS } from '../../styles/theme.js';

interface TypeIndicatorProps {
  type: 'thinking' | 'tool' | 'plan';
}

/**
 * Type indicator with animated dots for various AI operations
 * Based on Figma design color scheme
 */
export const TypeIndicator: React.FC<TypeIndicatorProps> = ({ type }) => {
  const [frame, setFrame] = useState(0);

  const colorMap = {
    thinking: COLORS.semantic.salmon, // Salmon pink for AI thinking
    tool: COLORS.semantic.orange, // Orange for tool execution
    plan: COLORS.semantic.blue, // Blue for planning
  };

  const labelMap = {
    thinking: 'THINKING',
    tool: 'TOOL',
    plan: 'PLAN',
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const dots = '.'.repeat(frame);

  return (
    <Text color={colorMap[type]} bold>
      {labelMap[type]}
      {dots}
    </Text>
  );
};
