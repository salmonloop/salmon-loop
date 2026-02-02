import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState } from 'react';

import { getSuggestions } from '../../commands/registry.js';
import { Command } from '../../commands/types.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
}

export const AutocompleteInput: React.FC<Props> = ({ value, onChange, onSubmit, placeholder }) => {
  const [suggestions, setSuggestions] = useState<Command[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleChange = (newValue: string) => {
    onChange(newValue);
    if (newValue.startsWith('/')) {
      const matches = getSuggestions(newValue);
      setSuggestions(matches);
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  };

  useInput((input, key) => {
    // Handle Tab completion
    if (key.tab && suggestions.length > 0) {
      const selectedCmd = suggestions[selectedIndex];
      onChange(selectedCmd.name + ' ');
      setSuggestions([]);
      return;
    }

    // Handle arrow keys for selection
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        setSelectedIndex(Math.min(suggestions.length - 1, selectedIndex + 1));
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* Suggestions Overlay */}
      {suggestions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="blue"
          paddingX={1}
          marginBottom={0}
        >
          {suggestions.map((cmd, index) => (
            <Text key={cmd.name} color={index === selectedIndex ? 'green' : 'gray'}>
              {cmd.name} - {cmd.description}
            </Text>
          ))}
        </Box>
      )}

      {/* Input Area */}
      <Box>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={(val) => {
            if (suggestions.length > 0) {
              // Complete from selected suggestion instead of submitting
              const selectedCmd = suggestions[selectedIndex];
              onChange(selectedCmd.name + ' ');
              setSuggestions([]);
            } else {
              onSubmit(val);
            }
          }}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
};
