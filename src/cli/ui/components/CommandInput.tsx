import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useState } from 'react';

import type { Command } from '../../commands/types.js';
import { en } from '../../locales/en.js';
import { rejectAuthorization } from '../authorization/bus.js';
import { UI_CONFIG } from '../config.js';
import { useCommandSuggestions } from '../hooks/useCommandSuggestions.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import { rejectSelection, resolveSelection } from '../selection/bus.js';
import { useUIStore } from '../store/context.js';
import { COLORS } from '../styles/theme.js';

import { CommandSuggestionList } from './CommandSuggestionList.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  getSuggestions: (
    input: string,
  ) => Promise<{ name: string; description: string; command?: Command }[]>;
  findCommand?: (name: string) => Command | undefined;
}

export const CommandInput: React.FC<Props> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  getSuggestions,
  findCommand,
}) => {
  const { state, dispatch } = useUIStore();
  const { pendingConfirmation } = state;
  const { pendingAuthorization } = state;
  const { pendingSelection } = state;
  const isConfirming = !!pendingConfirmation;
  const isAuthorizing = !!pendingAuthorization;
  const isSelecting = !!pendingSelection;
  const isMultiSelecting = Boolean(pendingSelection?.multiSelect);
  const isIntercepting = isAuthorizing || isConfirming || isSelecting;
  const activeChallenge = pendingAuthorization?.challenge || pendingConfirmation?.challenge;

  const [inputKey, setInputKey] = useState(0);
  const [selectionIndex, setSelectionIndex] = useState(0);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const suppressNextInputChangeRef = React.useRef(false);

  React.useEffect(() => {
    if (pendingSelection) {
      setSelectionIndex(0);
      setSelectedItems([]);
    }
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
    activeCommand,
  } = useCommandSuggestions(value, getSuggestions as any, isIntercepting, findCommand);

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

  useInput((input, key) => {
    if (
      key.ctrl &&
      (input === 't' || input === 'T' || input === '\u0014' || (key as any).name === 't')
    ) {
      suppressNextInputChangeRef.current = true;
      return;
    }

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
      if (isMultiSelecting && input === ' ') {
        const picked = items[selectionIndex]?.id;
        if (!picked) return;
        setSelectedItems((prev) =>
          prev.includes(picked) ? prev.filter((id) => id !== picked) : [...prev, picked],
        );
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
            if (suppressNextInputChangeRef.current) {
              suppressNextInputChangeRef.current = false;
              if (val === `${value}t` || val === `${value}T` || val === `${value}\u0014`) {
                return;
              }
            }
            setIsListClosed(false);
            resetHistory();
            onChange(val);
          }}
          onSubmit={(val) => {
            if (isSelecting && pendingSelection) {
              const items = pendingSelection.items ?? [];
              if (isMultiSelecting) {
                resolveSelection(
                  pendingSelection.id,
                  selectedItems.length > 0 ? selectedItems : [],
                );
              } else {
                const picked = items[selectionIndex]?.id ?? null;
                resolveSelection(pendingSelection.id, picked ? [picked] : []);
              }
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
            if (val.trim()) {
              dispatch({ type: 'APPEND_INPUT', payload: val });
            }
            onSubmit(val);
          }}
          placeholder={
            isSelecting
              ? isMultiSelecting
                ? en.gui.selectionPlaceholderMulti
                : en.gui.selectionPlaceholder
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
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={COLORS.semantic.yellow}
          paddingX={1}
        >
          <Text color={COLORS.semantic.yellow} bold>
            {isSelecting
              ? pendingSelection?.title
              : isAuthorizing
                ? en.gui.authorizationTitle
                : en.gui.confirmationTitle}
          </Text>
          {!isSelecting && (
            <Text color={COLORS.text.primary}>
              {isAuthorizing ? pendingAuthorization?.message : pendingConfirmation?.message}
            </Text>
          )}
          <Text color={COLORS.text.muted} dimColor>
            {isSelecting
              ? isMultiSelecting
                ? en.gui.selectionHintMulti
                : en.gui.selectionHint
              : isAuthorizing
                ? en.gui.authorizationWarning
                : en.gui.highRiskWarning}
          </Text>
          {isAuthorizing && (
            <Text color={COLORS.text.muted} dimColor>
              {en.gui.authorizationHint}
            </Text>
          )}
          {isSelecting && pendingSelection && (
            <Box flexDirection="column" marginTop={1}>
              {pendingSelection.items.map((item, idx) => {
                const isSelected = idx === selectionIndex;
                const isChecked = selectedItems.includes(item.id);

                return (
                  <Box key={item.id} flexDirection="row">
                    <Box width={2}>
                      <Text color={isSelected ? COLORS.semantic.salmon : COLORS.text.muted}>
                        {isSelected ? '❯ ' : '  '}
                      </Text>
                    </Box>
                    <Text color={isSelected ? COLORS.semantic.cyan : COLORS.text.muted}>
                      {isMultiSelecting && (
                        <Text color={isChecked ? COLORS.semantic.cyan : COLORS.text.muted}>
                          {isChecked ? '[x] ' : '[ ] '}
                        </Text>
                      )}
                      <Text bold={isSelected}>{item.label}</Text>
                      {item.description ? ` - ${item.description}` : ''}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      {!isIntercepting && suggestions.length > 0 && !isListClosed && (
        <CommandSuggestionList
          suggestions={visibleSuggestions}
          selectedIndex={selectedIndex - startIndex}
          parentCommand={activeCommand}
        />
      )}
    </Box>
  );
};
