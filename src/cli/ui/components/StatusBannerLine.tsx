import { Box, Text } from 'ink';
import React from 'react';

import { formatStatusBanner } from '../status/formatStatusBanner.js';

export function StatusBannerLine(props: { face: string; label?: string }) {
  return (
    <Box height={1}>
      <Text color="gray" bold>
        {formatStatusBanner({ face: props.face, label: props.label })}
      </Text>
    </Box>
  );
}
