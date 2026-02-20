import { Text } from 'ink';
import React, { useEffect, useState } from 'react';

import { COLORS } from '../../styles/theme.js';

function tailByLines(input: string, maxLines: number): { tail: string; truncated: boolean } {
  if (!input) return { tail: '', truncated: false };
  if (!Number.isFinite(maxLines) || maxLines <= 0) return { tail: '', truncated: true };

  let newlineCount = 0;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    if (input[i] !== '\n') continue;
    newlineCount += 1;
    if (newlineCount === maxLines) {
      return { tail: input.slice(i + 1), truncated: true };
    }
  }

  return { tail: input, truncated: false };
}

export const StreamingCursor = () => {
  const enableBlink = process.env.SALMON_UI_BLINK_STREAMING === '1';
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!enableBlink) return;
    const interval = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(interval);
  }, [enableBlink]);
  return <Text color={COLORS.semantic.blue}>{!enableBlink || visible ? '█' : ' '}</Text>;
};

export const StreamIndicator = () => {
  const enableBlink = process.env.SALMON_UI_BLINK_STREAMING === '1';
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!enableBlink) return;
    const interval = setInterval(() => setVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, [enableBlink]);

  return <Text color={COLORS.semantic.salmon}>{!enableBlink || visible ? '[*]' : '[ ]'}</Text>;
};

export const StreamingText = React.memo<{ content: string; maxLines: number }>(
  ({ content, maxLines }) => {
    const { tail, truncated } = tailByLines(content, maxLines);
    if (!truncated) return <Text>{tail}</Text>;
    if (!tail) return <Text color="gray">…</Text>;
    return (
      <Text>
        <Text color="gray" dimColor>
          {'…\n'}
        </Text>
        {tail}
      </Text>
    );
  },
);
