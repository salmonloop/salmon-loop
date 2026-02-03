import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState, useEffect, useRef } from 'react';

import { en } from '../../locales/en.js';
import { UI_CONFIG } from '../config.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  getSuggestions: (input: string) => Promise<{ name: string; description: string }[]>;
}

export const AutocompleteInput: React.FC<Props> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  getSuggestions,
}) => {
  const [suggestions, setSuggestions] = useState<{ name: string; description: string }[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [startIndex, setStartIndex] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const [lastManualInput, setLastManualInput] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  const [isListClosed, setIsListClosed] = useState(false);
  const justCompletedRef = useRef(false);

  // Declarative suggestion updates: react to value changes regardless of source
  useEffect(() => {
    // If the change was triggered by arrow key navigation or list is explicitly closed,
    // don't re-fetch suggestions to avoid flickering or unwanted popups.
    if (isNavigating || isListClosed) return;

    let isMounted = true;
    const updateSuggestions = async () => {
      if (value.startsWith('/')) {
        const matches = await getSuggestions(value);
        if (isMounted) {
          setSuggestions(matches);

          // Logic: Auto-focus if the suggestion matches the current token being typed
          // We trim to ignore the trailing space added after completion
          const parts = value.trim().split(/\s+/);
          const currentToken = parts[parts.length - 1];

          const exactMatchIndex =
            value.length > 1 && currentToken.length > 0
              ? matches.findIndex((m) => m.name.toLowerCase().includes(currentToken.toLowerCase()))
              : -1;

          setSelectedIndex(exactMatchIndex);
          setStartIndex(0);
          setLastManualInput(value);
        }
      } else {
        if (isMounted) {
          setSuggestions([]);
        }
      }
    };

    updateSuggestions();
    return () => {
      isMounted = false;
    };
  }, [value, getSuggestions, isNavigating, isListClosed]);

  const handleChange = (newValue: string) => {
    setIsNavigating(false);
    setIsListClosed(false);
    onChange(newValue);
  };

  const getCompletedValue = (selectedName: string) => {
    const parts = lastManualInput.trimStart().split(/\s+/);
    if (parts.length === 1 && !lastManualInput.includes(' ')) {
      return selectedName + ' ';
    }
    return parts[0] + ' ' + selectedName + ' ';
  };

  const applySelection = (
    selected: { name: string; description: string },
    config: { closeList: boolean; navigating: boolean },
  ) => {
    const nextValue = getCompletedValue(selected.name);

    if (config.closeList) {
      setSuggestions([]);
      setSelectedIndex(-1);
      setStartIndex(0);
      setIsListClosed(true);
      justCompletedRef.current = true;
    }

    setIsNavigating(config.navigating);
    // Atomic remount via key change to reset cursor position
    setInputKey((prev) => prev + 1);
    onChange(nextValue);
  };

  useInput((input, key) => {
    // Completion only works if an item is focused
    if (
      (key.tab || key.return) &&
      suggestions.length > 0 &&
      !isListClosed &&
      selectedIndex !== -1
    ) {
      applySelection(suggestions[selectedIndex], {
        closeList: key.return,
        navigating: false,
      });
      return;
    }

    if (suggestions.length > 0 && !isListClosed) {
      const maxVisible = UI_CONFIG.MAX_SUGGESTIONS;
      let newIndex = selectedIndex;

      if (key.upArrow) {
        if (selectedIndex === -1) {
          newIndex = suggestions.length - 1;
        } else {
          newIndex = selectedIndex === 0 ? suggestions.length - 1 : selectedIndex - 1;
        }
      } else if (key.downArrow) {
        if (selectedIndex === -1) {
          newIndex = 0;
        } else {
          newIndex = selectedIndex === suggestions.length - 1 ? 0 : selectedIndex + 1;
        }
      }

      if (newIndex !== selectedIndex) {
        setSelectedIndex(newIndex);
        applySelection(suggestions[newIndex], {
          closeList: false,
          navigating: true,
        });

        if (newIndex < startIndex) {
          setStartIndex(newIndex);
        } else if (newIndex >= startIndex + maxVisible) {
          setStartIndex(newIndex - maxVisible + 1);
        } else if (
          (selectedIndex === 0 && newIndex === suggestions.length - 1) ||
          (selectedIndex === suggestions.length - 1 && newIndex === 0)
        ) {
          if (newIndex === 0) {
            setStartIndex(0);
          } else {
            setStartIndex(Math.max(0, suggestions.length - maxVisible));
          }
        }
      }
    }
  });

  const visibleSuggestions = suggestions.slice(startIndex, startIndex + UI_CONFIG.MAX_SUGGESTIONS);

  return (
    <Box flexDirection="column">
      <Box>
        <TextInput
          key={inputKey}
          value={value}
          onChange={handleChange}
          onSubmit={(val) => {
            if (justCompletedRef.current) {
              justCompletedRef.current = false;
              return;
            }
            // Allow submission if no focus or no suggestions
            if (selectedIndex === -1 || suggestions.length === 0) {
              onSubmit(val);
            }
          }}
          placeholder={placeholder}
        />
      </Box>

      {suggestions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginTop={0}
        >
          {visibleSuggestions.map((cmd, index) => {
            const actualIndex = startIndex + index;
            return (
              <Text key={cmd.name} color={actualIndex === selectedIndex ? 'green' : 'gray'}>
                {cmd.name} - {cmd.description}
              </Text>
            );
          })}
          {suggestions.length > UI_CONFIG.MAX_SUGGESTIONS && (
            <Text color="gray" dimColor italic>
              {en.gui.scrollHint(selectedIndex === -1 ? 0 : selectedIndex + 1, suggestions.length)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
