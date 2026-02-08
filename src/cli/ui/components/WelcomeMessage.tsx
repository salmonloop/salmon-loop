import { createRequire } from 'module';

import { Box, Text } from 'ink';
import React from 'react';

const require = createRequire(import.meta.url);
const pkg = require('../../../../package.json');

export const WelcomeMessage: React.FC = () => {
  // Logo parts split for two-tone coloring
  const logoLine1_salmon = '█▀▀ ▄▀█ █   █▀▄▀█ █▀█ █▄ █';
  const logoLine1_loop = '   █   █▀█ █▀█ █▀█';
  const logoLine2_salmon = '▄▄█ █▀█ █▄▄ █ ▀ █ █▄█ █ ▀█';
  const logoLine2_loop = '   █▄▄ █▄█ █▄█ █▀▀';

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Top decorative line with swimming fish */}
      <Box flexDirection="row" marginBottom={1}>
        <Text color="#30363d">{'═'.repeat(30)}</Text>
        <Text color="#d95030"> {'><>'} </Text>
        <Text color="#30d9b9"> {'><>'} </Text>
        <Text color="#3095d9"> {'><>'} </Text>
        <Text color="#30363d">{'═'.repeat(30)}</Text>
      </Box>

      {/* ASCII Logo - Two-tone coloring */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Box flexDirection="row">
          <Text color="#d95030">{logoLine1_salmon}</Text>
          <Text color="#30d9b9">{logoLine1_loop}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color="#d95030">{logoLine2_salmon}</Text>
          <Text color="#30d9b9">{logoLine2_loop}</Text>
        </Box>
      </Box>

      {/* Version & Tagline */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text color="#6e7681">v{pkg.version} · CLI Edition</Text>
        <Text color="#3095d9" italic>
          Keep swimming upstream, loop until perfect
        </Text>
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text color="#30363d">{'─'.repeat(75)}</Text>
      </Box>

      {/* Welcome greeting */}
      <Box
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor="#d95030"
        paddingLeft={1}
        marginBottom={1}
        flexDirection="column"
      >
        <Text>
          <Text color="#d95030" bold>{`<><`}</Text>
          <Text color="#c7d1db"> Hey there! I'm </Text>
          <Text color="#d95030" bold>
            Salmon
          </Text>
          <Text color="#c7d1db">, your lazy-but-precise AI coding assistant.</Text>
        </Text>
        <Text color="#6e7681">
          (Don't worry, I won't break anything... <Text italic>probably</Text> ｡◕‿◕｡)
        </Text>
      </Box>

      {/* Quick Start & Tips */}
      <Box flexDirection="row" gap={2} marginBottom={1}>
        {/* Left: Commands */}
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="#21262d"
          paddingX={1}
          flexGrow={1}
        >
          <Text color="#3095d9" bold>
            → QUICK START
          </Text>
          <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row">
              <Box width={10}>
                <Text color="#30d9b9">/new</Text>
              </Box>
              <Text color="#6e7681">Start a new session</Text>
            </Box>
            <Box flexDirection="row">
              <Box width={10}>
                <Text color="#30d9b9">/status</Text>
              </Box>
              <Text color="#6e7681">Check progress</Text>
            </Box>
            <Box flexDirection="row">
              <Box width={10}>
                <Text color="#30d9b9">/help</Text>
              </Box>
              <Text color="#6e7681">Show all commands</Text>
            </Box>
          </Box>
        </Box>

        {/* Right: Tips */}
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="#21262d"
          paddingX={1}
          flexGrow={1}
        >
          <Text color="#3095d9" bold>
            → PRO TIPS
          </Text>
          <Box flexDirection="column" marginTop={0}>
            <Text color="#6e7681">• Ctrl+Space to toggle commands</Text>
            <Text color="#6e7681">• I'll show my thinking process</Text>
            <Text color="#6e7681">• ^C to interrupt if needed</Text>
          </Box>
        </Box>
      </Box>

      {/* Call to action */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color="#6e7681">Type anything to begin, or try: </Text>
        <Text color="#d95030">/new create a todo app</Text>
      </Box>

      {/* Bottom decorative line */}
      <Box flexDirection="row">
        <Text color="#30363d">{'═'.repeat(30)}</Text>
        <Text color="#6e7681"> Ready to code </Text>
        <Text color="#30363d">{'═'.repeat(30)}</Text>
      </Box>
    </Box>
  );
};
