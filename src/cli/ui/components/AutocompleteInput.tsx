import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState, useEffect } from 'react';

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
  const [isCompleting, setIsCompleting] = useState(false);

  // One-tick remount to force cursor to the end
  useEffect(() => {
    if (isCompleting) {
      setIsCompleting(false);
    }
  }, [isCompleting]);

  const handleChange = (newValue: string) => {
    if (isCompleting) return;
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
    // Handle Tab or Enter completion
    if ((key.tab || key.return) && suggestions.length > 0) {
      const selectedCmd = suggestions[selectedIndex];
      // 1. Clear suggestions
      setSuggestions([]);
      setSelectedIndex(0);
      // 2. Trigger remount
      setIsCompleting(true);
      // 3. Update value with trailing space
      onChange(selectedCmd.name + ' ');
      return;
    }

    // Handle arrow keys for selection with looping
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(selectedIndex === 0 ? suggestions.length - 1 : selectedIndex - 1);
      } else if (key.downArrow) {
        setSelectedIndex(selectedIndex === suggestions.length - 1 ? 0 : selectedIndex + 1);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* Input Area - Remounting forces ink-text-input to reset cursor to end */}
      <Box>
        {!isCompleting && (
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={(val) => {
              if (suggestions.length === 0) {
                onSubmit(val);
              }
            }}
            placeholder={placeholder}
          />
        )}
      </Box>

      {/* Suggestions Overlay - Moved below input and changed border color to gray */}
      {suggestions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginTop={0}
        >
          {suggestions.map((cmd, index) => (
            <Text key={cmd.name} color={index === selectedIndex ? 'green' : 'gray'}>
              {cmd.name} - {cmd.description}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
