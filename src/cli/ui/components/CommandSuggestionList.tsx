import { Box, Text } from 'ink';
import React from 'react';

import type { Command } from '../../commands/types.js';
import { COLORS } from '../styles/theme.js';

interface CommandSuggestionListProps {
  suggestions: { name: string; description: string; command?: Command }[];
  selectedIndex: number;
  parentCommand?: Command;
  filterText?: string;
  totalCount?: number;
  startIndex?: number;
}

export const CommandSuggestionList: React.FC<CommandSuggestionListProps> = ({
  suggestions,
  selectedIndex,
  parentCommand,
  totalCount = suggestions.length,
  startIndex = 0,
}) => {
  if (suggestions.length === 0) return null;

  // Header Title Logic
  let title = 'SLASH COMMANDS';
  if (parentCommand) {
    title = `${parentCommand.name} / SUBCOMMANDS`;
  }

  // Calculate dynamic column width
  const maxNameLength = suggestions.reduce((max, s) => Math.max(max, s.name.length), 0);

  const moreAbove = startIndex;
  const moreBelow = totalCount - (startIndex + suggestions.length);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border.subtle}
      marginTop={0}
      marginBottom={0}
      paddingX={0}
      width="100%"
    >
      {/* CONTENT: Command List */}
      <Box flexDirection="column" paddingY={0}>
        {moreAbove > 0 && (
          <Box paddingX={1}>
            <Text color={COLORS.text.muted} dimColor>
              ↑ {moreAbove} more command{moreAbove === 1 ? '' : 's'} above
            </Text>
          </Box>
        )}
        {suggestions.map((item, index) => {
          const isSelected = index === selectedIndex;
          const hasSubcommands = !!item.command?.subcommands?.length;

          return (
            <Box key={`${item.name}-${index}`} flexDirection="row" paddingX={1}>
              {/* Selection Indicator */}
              <Box width={2}>
                <Text color={COLORS.semantic.salmon}>{isSelected ? '❯ ' : '  '}</Text>
              </Box>

              {/* Command Name */}
              <Box width={maxNameLength + 4}>
                <Text
                  color={isSelected ? COLORS.semantic.cyan : COLORS.semantic.blue}
                  bold={isSelected}
                >
                  {item.name}
                </Text>
              </Box>

              {/* Subcommand Arrow */}
              <Box width={2} marginRight={1}>
                {hasSubcommands ? <Text color={COLORS.text.muted}>›</Text> : <Text> </Text>}
              </Box>

              {/* Description */}
              <Box flexGrow={1}>
                <Text color={isSelected ? COLORS.text.primary : COLORS.text.muted} wrap="truncate">
                  {item.description}
                </Text>
              </Box>
            </Box>
          );
        })}
        {moreBelow > 0 && (
          <Box paddingX={1}>
            <Text color={COLORS.text.muted} dimColor>
              ↓ {moreBelow} more command{moreBelow === 1 ? '' : 's'} below
            </Text>
          </Box>
        )}
      </Box>

      {/* FOOTER: Contextual Hints */}
      {suggestions[selectedIndex]?.command?.usage && (
        <Box
          flexDirection="row"
          borderStyle="single"
          borderTop={true}
          borderLeft={false}
          borderRight={false}
          borderBottom={false}
          borderColor={COLORS.border.subtle}
          paddingX={1}
          paddingY={0}
        >
          <Text color={COLORS.semantic.blue}>TIP: </Text>
          <Text color={COLORS.text.muted}>Usage: </Text>
          <Text color={COLORS.text.primary}>{suggestions[selectedIndex].command?.usage}</Text>
        </Box>
      )}

      {/* STATUS BAR (Formerly Header) */}
      <Box
        flexDirection="row"
        borderStyle="single"
        borderTop={true}
        borderLeft={false}
        borderRight={false}
        borderBottom={false}
        borderColor={COLORS.border.subtle}
        paddingX={1}
        paddingY={0}
        justifyContent="space-between"
      >
        <Box>
          <Text color={COLORS.semantic.salmon}>│ </Text>
          <Text color={COLORS.semantic.blue} bold>
            {title}
          </Text>
        </Box>
        <Box>
          <Text color={COLORS.text.muted} dimColor>
            ↑↓ nav · ⏎ select · esc close
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
