import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState } from 'react';

import { en } from '../../locales/en.js';
import { rejectAuthorization } from '../authorization/bus.js';
import { UI_CONFIG } from '../config.js';
import { useAutocomplete } from '../hooks/useAutocomplete.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
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
  const { pendingAuthorization } = state;
  const isConfirming = !!pendingConfirmation;
  const isAuthorizing = !!pendingAuthorization;
  const isIntercepting = isAuthorizing || isConfirming;
  const activeChallenge = pendingAuthorization?.challenge || pendingConfirmation?.challenge;

  const [inputKey, setInputKey] = useState(0);

  const {
    suggestions,
    selectedIndex,
    startIndex,
    isListClosed,
    setIsListClosed,
    setSuggestions,
    setSelectedIndex,
    setStartIndex,
    navigateSuggestions,
  } = useAutocomplete(value, getSuggestions, isIntercepting);

  const { navigateHistory, resetHistory } = useInputHistory(value, (val) => {
    setInputKey((prev) => prev + 1);
    onChange(val);
  });

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
    config: { closeList: boolean },
  ) => {
    const nextValue = getCompletedValue(selected.name);

    if (config.closeList) {
      setSuggestions([]);
      setSelectedIndex(-1);
      setStartIndex(0);
      setIsListClosed(true);
    } else {
      setIsListClosed(false);
    }

    setInputKey((prev) => prev + 1);
    onChange(nextValue);
  };

  useInput((_, key) => {
    if (key.escape) {
      if (!isListClosed && suggestions.length > 0) {
        setIsListClosed(true);
      } else if (isAuthorizing) {
        rejectAuthorization();
      } else if (isConfirming) {
        dispatch({ type: 'CLEAR_CONFIRMATION' });
      }
      return;
    }

    if (isIntercepting) return;

    if (
      (key.rightArrow || key.tab) &&
      suggestions.length > 0 &&
      !isListClosed &&
      selectedIndex !== -1
    ) {
      applySelection(suggestions[selectedIndex], { closeList: false });
      return;
    }

    if (key.upArrow) {
      if (!navigateSuggestions('up')) {
        navigateHistory('up');
      }
    } else if (key.downArrow) {
      if (!navigateSuggestions('down')) {
        navigateHistory('down');
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
          onChange={(val) => {
            setIsListClosed(false);
            resetHistory();
            onChange(val);
          }}
          onSubmit={(val) => {
            if (isIntercepting && activeChallenge) {
              const trimmed = val.trim();
              if (trimmed === activeChallenge || trimmed.startsWith(`${activeChallenge} `)) {
                onSubmit(val);
              }
              return;
            }

            if (suggestions.length > 0 && !isListClosed && selectedIndex !== -1) {
              applySelection(suggestions[selectedIndex], { closeList: false });
              return;
            }

            resetHistory();
            onSubmit(val);
          }}
          placeholder={
            isIntercepting && activeChallenge
              ? en.gui.confirmationChallenge(activeChallenge)
              : placeholder
          }
        />
        {ghostText && (
          <Text color="gray" dimColor>
            {ghostText}
          </Text>
        )}
      </Box>

      {isIntercepting && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>
            {isAuthorizing ? en.gui.authorizationTitle : en.gui.confirmationTitle}
          </Text>
          <Text color="white">
            {isAuthorizing ? pendingAuthorization?.message : pendingConfirmation?.message}
          </Text>
          <Text color="gray" dimColor>
            {isAuthorizing ? en.gui.authorizationWarning : en.gui.highRiskWarning}
          </Text>
          {isAuthorizing && (
            <Text color="gray" dimColor>
              {en.gui.authorizationHint}
            </Text>
          )}
        </Box>
      )}

      {!isIntercepting && suggestions.length > 0 && !isListClosed && (
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
