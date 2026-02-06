import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState } from 'react';

import { en } from '../../locales/en.js';
import { rejectAuthorization } from '../authorization/bus.js';
import { UI_CONFIG } from '../config.js';
import { useAutocomplete } from '../hooks/useAutocomplete.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import { rejectSelection, resolveSelection } from '../selection/bus.js';
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
  const { pendingSelection } = state;
  const isConfirming = !!pendingConfirmation;
  const isAuthorizing = !!pendingAuthorization;
  const isSelecting = !!pendingSelection;
  const isIntercepting = isAuthorizing || isConfirming || isSelecting;
  const activeChallenge = pendingAuthorization?.challenge || pendingConfirmation?.challenge;

  const [inputKey, setInputKey] = useState(0);
  const [selectionIndex, setSelectionIndex] = useState(0);

  React.useEffect(() => {
    if (pendingSelection) setSelectionIndex(0);
  }, [pendingSelection?.id]);

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
    const selected = suggestions[selectedIndex].name.trimEnd();
    const parts = value.split(/\s+/);
    const lastToken = parts[parts.length - 1];

    if (selected.toLowerCase().startsWith(lastToken.toLowerCase())) {
      return selected.slice(lastToken.length);
    }
    return '';
  };

  const getCompletedValue = (selectedName: string) => {
    const parts = value.split(/\s+/);
    const trimmedName = selectedName.trimEnd();
    if (value.endsWith(' ')) {
      return value + trimmedName + ' ';
    }
    parts.pop();
    const prefix = parts.join(' ');
    return (prefix ? prefix + ' ' : '') + trimmedName + ' ';
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
      } else if (isSelecting) {
        rejectSelection();
      } else if (isAuthorizing) {
        rejectAuthorization();
      } else if (isConfirming) {
        dispatch({ type: 'CLEAR_CONFIRMATION' });
      }
      return;
    }

    if (isSelecting) {
      const items = pendingSelection?.items ?? [];
      if (key.upArrow) {
        if (items.length > 0) {
          setSelectionIndex((prev) => (prev - 1 + items.length) % items.length);
        }
        return;
      }
      if (key.downArrow) {
        if (items.length > 0) {
          setSelectionIndex((prev) => (prev + 1) % items.length);
        }
        return;
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
  const maxSuggestionNameLength = suggestions.reduce((max, suggestion) => {
    const trimmed = suggestion.name.trimEnd();
    return Math.max(max, trimmed.length);
  }, 0);
  const formatSuggestionName = (name: string) => {
    const trimmed = name.trimEnd();
    return trimmed.padEnd(maxSuggestionNameLength + 2);
  };
  const ghostText = getGhostText();

  return (
    <Box flexDirection="column">
      <Box>
        <TextInput
          key={inputKey}
          value={isSelecting ? '' : value}
          focus={true}
          onChange={(val) => {
            if (isSelecting) return;
            setIsListClosed(false);
            resetHistory();
            onChange(val);
          }}
          onSubmit={(val) => {
            if (isSelecting && pendingSelection) {
              const items = pendingSelection.items ?? [];
              const picked = items[selectionIndex]?.id ?? null;
              resolveSelection(pendingSelection.id, picked);
              dispatch({ type: 'SET_INPUT', payload: '' });
              return;
            }
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
            isSelecting
              ? en.gui.selectionPlaceholder
              : isIntercepting && activeChallenge
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
            {isSelecting
              ? pendingSelection?.title
              : isAuthorizing
                ? en.gui.authorizationTitle
                : en.gui.confirmationTitle}
          </Text>
          {!isSelecting && (
            <Text color="white">
              {isAuthorizing ? pendingAuthorization?.message : pendingConfirmation?.message}
            </Text>
          )}
          <Text color="gray" dimColor>
            {isSelecting
              ? en.gui.selectionHint
              : isAuthorizing
                ? en.gui.authorizationWarning
                : en.gui.highRiskWarning}
          </Text>
          {isAuthorizing && (
            <Text color="gray" dimColor>
              {en.gui.authorizationHint}
            </Text>
          )}
          {isSelecting && pendingSelection && (
            <Box flexDirection="column" marginTop={1}>
              {pendingSelection.items.map((item, idx) => (
                <Text key={item.id} color={idx === selectionIndex ? 'green' : 'gray'}>
                  {item.label}
                  {item.description ? ` - ${item.description}` : ''}
                </Text>
              ))}
            </Box>
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
                {formatSuggestionName(cmd.name)}- {cmd.description}
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
