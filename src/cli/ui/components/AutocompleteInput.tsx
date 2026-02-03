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
  const [lastManualInput, setLastManualInput] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  const [isListClosed, setIsListClosed] = useState(false);
  const justCompletedRef = useRef(false);

  // Declarative suggestion updates: react to value changes regardless of source
  useEffect(() => {
    // If confirming or navigating or list is explicitly closed, don't re-fetch
    if (isConfirming || isNavigating || isListClosed) return;

    let isMounted = true;
    const updateSuggestions = async () => {
      if (value.startsWith('/')) {
        const matches = await getSuggestions(value);
        if (isMounted) {
          setSuggestions(matches);

          const parts = value.split(/\s+/);
          const currentToken = value.endsWith(' ') ? '' : parts[parts.length - 1];

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
  }, [value, getSuggestions, isNavigating, isListClosed, isConfirming]);

  const handleChange = (newValue: string) => {
    setIsNavigating(false);
    setIsListClosed(false);
    onChange(newValue);
  };

  const getCompletedValue = (selectedName: string) => {
    const parts = lastManualInput.split(/\s+/);
    // Remove the last part being typed and replace it with selection
    if (lastManualInput.endsWith(' ')) {
      return lastManualInput + selectedName + ' ';
    }
    parts.pop();
    const prefix = parts.join(' ');
    return (prefix ? prefix + ' ' : '') + selectedName + ' ';
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
    setInputKey((prev) => prev + 1);
    onChange(nextValue);
  };

  useInput((input, key) => {
    // 统一逃逸逻辑 (ESC Handling)
    if (key.escape) {
      if (isConfirming) {
        dispatch({ type: 'CLEAR_CONFIRMATION' });
      } else {
        setSuggestions([]);
        setIsListClosed(true);
      }
      return;
    }

    // Completion only works if not in confirmation mode
    if (isConfirming) return;

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
            if (selectedIndex === -1 || suggestions.length === 0) {
              onSubmit(val);
            }
          }}
          placeholder={
            isConfirming
              ? `请输入 [${pendingConfirmation.challenge}] 确认执行 (Esc 取消)`
              : placeholder
          }
        />
      </Box>

      {isConfirming && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>
            ⚠️ 需要确认
          </Text>
          <Text color="white">{pendingConfirmation.message}</Text>
          <Text color="gray" dimColor>
            当前操作涉及物理代码还原，请输入校验码以继续。
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
