import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState, useEffect, useRef } from 'react';

import { en } from '../../locales/en.js';
import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';

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
  const { state, dispatch } = useUIStore();
  const { pendingConfirmation } = state;
  const isConfirming = !!pendingConfirmation;

  const [suggestions, setSuggestions] = useState<{ name: string; description: string }[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [startIndex, setStartIndex] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const [isListClosed, setIsListClosed] = useState(false);
  const justCompletedRef = useRef(false);

  // Calculate ghost text for non-intrusive suggestions
  const getGhostText = () => {
    if (selectedIndex === -1 || suggestions.length === 0 || isListClosed) return '';
    const selected = suggestions[selectedIndex].name;
    const parts = value.split(/\s+/);
    const lastToken = parts[parts.length - 1];

    if (selected.toLowerCase().startsWith(lastToken.toLowerCase())) {
      return selected.slice(lastToken.length);
    }
    return '';
  };

  // Declarative suggestion updates: react to value changes regardless of source
  useEffect(() => {
    // If confirming or list is explicitly closed, don't re-fetch
    if (isConfirming || isListClosed) return;

    let isMounted = true;
    const updateSuggestions = async () => {
      if (value.startsWith('/')) {
        const matches = await getSuggestions(value);
        if (isMounted) {
          setSuggestions(matches);

          const parts = value.split(/\s+/);
          const currentToken = value.endsWith(' ') ? '' : parts[parts.length - 1];

          // Default to the first matching item
          const exactMatchIndex =
            value.length > 1 && currentToken.length > 0
              ? matches.findIndex((m) =>
                  m.name.toLowerCase().startsWith(currentToken.toLowerCase()),
                )
              : -1;

          setSelectedIndex(exactMatchIndex !== -1 ? exactMatchIndex : matches.length > 0 ? 0 : -1);
          setStartIndex(0);
        }
      } else {
        if (isMounted) {
          setSuggestions([]);
          setSelectedIndex(-1);
        }
      }
    };

    updateSuggestions();
    return () => {
      isMounted = false;
    };
  }, [value, getSuggestions, isListClosed, isConfirming]);

  const handleChange = (newValue: string) => {
    setIsListClosed(false);
    onChange(newValue);
  };

  const getCompletedValue = (selectedName: string) => {
    const parts = value.split(/\s+/);
    if (value.endsWith(' ')) {
      return value + selectedName + ' ';
    }
    parts.pop();
    const prefix = parts.join(' ');
    return (prefix ? prefix + ' ' : '') + selectedName + ' ';
  };

  const applySelection = (
    selected: { name: string; description: string },
    config: { closeList: boolean; isEnter?: boolean },
  ) => {
    const nextValue = getCompletedValue(selected.name);

    if (config.closeList) {
      setSuggestions([]);
      setSelectedIndex(-1);
      setStartIndex(0);
      setIsListClosed(true);
    } else {
      // Ensure the tray re-opens for the next level of suggestions
      setIsListClosed(false);
    }

    // Always block immediate submission when picking from a list via Enter
    if (config.isEnter) {
      justCompletedRef.current = true;
    }

    setInputKey((prev) => prev + 1);
    onChange(nextValue);
  };

  useInput((_, key) => {
    // Escape handling: Close tray or cancel confirmation
    if (key.escape) {
      if (!isListClosed && suggestions.length > 0) {
        setIsListClosed(true);
      } else if (isConfirming) {
        dispatch({ type: 'CLEAR_CONFIRMATION' });
      }
      return;
    }

    if (isConfirming) return;

    // Adopt suggestion: Right Arrow or Tab
    if (
      (key.rightArrow || key.tab) &&
      suggestions.length > 0 &&
      !isListClosed &&
      selectedIndex !== -1
    ) {
      applySelection(suggestions[selectedIndex], { closeList: false, isEnter: false });
      return;
    }

    // Pick suggestion with Enter: behave like Tab (allow further arguments)
    if (key.return && suggestions.length > 0 && !isListClosed && selectedIndex !== -1) {
      applySelection(suggestions[selectedIndex], { closeList: false, isEnter: true });
      return;
    }

    // Navigate suggestions: Only update index, don't modify actual value
    if (suggestions.length > 0 && !isListClosed) {
      const maxVisible = UI_CONFIG.MAX_SUGGESTIONS;
      let newIndex = selectedIndex;

      if (key.upArrow) {
        newIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
      } else if (key.downArrow) {
        newIndex = selectedIndex === suggestions.length - 1 ? 0 : selectedIndex + 1;
      }

      if (newIndex !== selectedIndex) {
        setSelectedIndex(newIndex);
        if (newIndex < startIndex) {
          setStartIndex(newIndex);
        } else if (newIndex >= startIndex + maxVisible) {
          setStartIndex(newIndex - maxVisible + 1);
        }
      }
    }
  });

  const visibleSuggestions = suggestions.slice(startIndex, startIndex + UI_CONFIG.MAX_SUGGESTIONS);
  const ghostText = getGhostText();

  return (
    <Box flexDirection="column">
      <Box>
        <TextInput
          key={inputKey}
          value={value}
          focus={true}
          onChange={handleChange}
          onSubmit={(val) => {
            if (isConfirming) {
              if (val === pendingConfirmation.challenge) {
                onSubmit(val);
              }
              return;
            }

            if (justCompletedRef.current) {
              justCompletedRef.current = false;
              return;
            }
            onSubmit(val);
          }}
          placeholder={
            isConfirming ? en.gui.confirmationChallenge(pendingConfirmation.challenge) : placeholder
          }
        />
        {ghostText && (
          <Text color="gray" dimColor>
            {ghostText}
          </Text>
        )}
      </Box>

      {isConfirming && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>
            {en.gui.confirmationTitle}
          </Text>
          <Text color="white">{pendingConfirmation.message}</Text>
          <Text color="gray" dimColor>
            {en.gui.highRiskWarning}
          </Text>
        </Box>
      )}

      {!isConfirming && suggestions.length > 0 && !isListClosed && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginTop={0}
          marginBottom={0}
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
