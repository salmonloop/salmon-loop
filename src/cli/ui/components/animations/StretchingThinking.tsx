import { Text, Box } from 'ink';
import React, { useState, useEffect } from 'react';

/**
 * StretchingThinking Animation Component
 *
 * Sequence:
 * 1 -> 2 -> 3 -> 2 -> 1
 *
 * 1: _(:з｣∠)_
 * 2: _(:з｣                   ∠)_ (Internal body uses spaces)
 * 3:                   _(:з｣∠)_
 */
export const StretchingThinking: React.FC = () => {
  const [frame, setFrame] = useState(0);
  const maxUnderscores = 19;

  // Phases:
  // 0 to max: 1 -> 2 (Stretch with spaces)
  // max+1 to 2*max: 2 -> 3 (Shift Right)
  // 2*max+1 to 3*max: 3 -> 2 (Shift Left)
  // 3*max+1 to 4*max-1: 2 -> 1 (Shrink)
  const totalFrames = maxUnderscores * 4;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % totalFrames);
    }, 60);
    return () => clearInterval(timer);
  }, [totalFrames]);

  let content = '';

  if (frame <= maxUnderscores) {
    // Phase 1: 1 -> 2 (Stretch with spaces)
    content = `_(:з｣${' '.repeat(frame)}∠)_`;
  } else if (frame <= maxUnderscores * 2) {
    // Phase 2: 2 -> 3 (Shift Right)
    const shift = frame - maxUnderscores;
    content = `${' '.repeat(shift)}_(:з｣${' '.repeat(maxUnderscores - shift)}∠)_`;
  } else if (frame <= maxUnderscores * 3) {
    // Phase 3: 3 -> 2 (Shift Left)
    const shift = maxUnderscores * 3 - frame;
    content = `${' '.repeat(shift)}_(:з｣${' '.repeat(maxUnderscores - shift)}∠)_`;
  } else {
    // Phase 4: 2 -> 1 (Shrink)
    const stretch = maxUnderscores * 4 - frame;
    content = `_(:з｣${' '.repeat(stretch)}∠)_`;
  }

  return (
    <Box height={1}>
      <Text color="gray" bold>
        {content}
      </Text>
    </Box>
  );
};
