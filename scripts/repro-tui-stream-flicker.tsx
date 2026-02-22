#!/usr/bin/env bun
process.env.FORCE_COLOR = '3';

import { Box, Text, render } from 'ink';
import React from 'react';

import { StretchingThinking } from '../src/cli/ui/components/animations/StretchingThinking.js';
import { MessageList } from '../src/cli/ui/components/MessageList.js';
import { UI_CONFIG } from '../src/cli/ui/config.js';
import { UIStoreProvider, useUIStore } from '../src/cli/ui/store/context.js';

function buildLongMarkdown(index: number): string {
  return [
    `# Message ${index}`,
    '',
    'This is a long streaming payload to stress Ink layout and markdown rendering.',
    '',
    '```ts',
    'export function hello(name: string) {',
    `  return "hello " + name + " (${index})";`,
    '}',
    '```',
    '',
    '- item 1',
    '- item 2',
    '- item 3',
    '',
  ].join('\n');
}

const ReproApp: React.FC<{ durationMs: number }> = ({ durationMs }) => {
  const { dispatch } = useUIStore();

  React.useEffect(() => {
    dispatch({
      type: 'UPDATE_DIMENSIONS',
      payload: {
        width: process.stdout.columns || UI_CONFIG.DEFAULT_WIDTH,
        height: process.stdout.rows || UI_CONFIG.DEFAULT_HEIGHT,
      },
    });
    dispatch({ type: 'SET_THINKING', payload: true });

    for (let i = 0; i < 40; i += 1) {
      dispatch({
        type: 'ADD_MESSAGE',
        payload: {
          id: `seed-${i}`,
          type: 'system',
          content: buildLongMarkdown(i),
          timestamp: new Date(),
        },
      });
    }

    const streamId = 'repro-stream';
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      const delta = step % 5 === 0 ? '\n' : ` token-${step}`;
      dispatch({
        type: 'APPEND_LLM_STREAM',
        payload: { id: streamId, delta, timestamp: new Date() },
      });
      if (step % 60 === 0) {
        dispatch({
          type: 'ADD_MESSAGE',
          payload: {
            id: `noise-${step}`,
            type: 'system',
            content: buildLongMarkdown(step),
            timestamp: new Date(),
          },
        });
      }
    }, 50);

    const stop = setTimeout(
      () => {
        clearInterval(timer);
        dispatch({ type: 'COMPLETE_STREAM', payload: { id: streamId } });
      },
      Math.max(500, durationMs - 300),
    );

    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [dispatch, durationMs]);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column" paddingX={UI_CONFIG.MESSAGE_AREA_PADDING_X}>
        <MessageList />
      </Box>
      <Box paddingX={UI_CONFIG.MESSAGE_AREA_PADDING_X} flexShrink={0}>
        <StretchingThinking />
      </Box>
      <Box
        flexDirection="column"
        flexShrink={0}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Box paddingY={1} flexDirection="row" paddingX={UI_CONFIG.INPUT_ROW_PADDING_X}>
          <Text>{'repro>'} </Text>
          <Text color="gray">Streaming…</Text>
        </Box>
      </Box>
    </Box>
  );
};

export async function main() {
  const durationMs = Number(process.env.REPRO_DURATION_MS || 5000);
  const { waitUntilExit, unmount } = render(
    <UIStoreProvider>
      <ReproApp durationMs={durationMs} />
    </UIStoreProvider>,
    { exitOnCtrlC: true },
  );

  setTimeout(() => {
    unmount();
  }, durationMs);

  await waitUntilExit();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
