import { useState, useEffect, useCallback } from 'react';

import { findCommand } from '../../commands/registry.js';
import type { Command } from '../../commands/types.js';
import { UI_CONFIG } from '../config.js';

interface Suggestion {
  name: string;
  description: string;
  command?: Command;
}

export function useCommandSuggestions(
  value: string,
  getSuggestions: (input: string) => Promise<Suggestion[]>,
  isConfirming: boolean,
) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [startIndex, setStartIndex] = useState(0);
  const [isListClosed, setIsListClosed] = useState(false);
  const [activeCommand, setActiveCommand] = useState<Command | undefined>(undefined);

  // Determine active command for context
  useEffect(() => {
    if (value.trim().startsWith('/')) {
      const parts = value.trim().split(/\s+/);
      // If we have at least one space, we might be in a subcommand
      // e.g. "/snapshot " -> parts=["/snapshot", ""] (length 2)
      if (parts.length > 1 || (parts.length === 1 && value.endsWith(' '))) {
        const cmdName = parts[0];
        const cmd = findCommand(cmdName);
        setActiveCommand(cmd);
        return;
      }
    }
    setActiveCommand(undefined);
  }, [value]);

  useEffect(() => {
    if (isConfirming || isListClosed) return;

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

  const navigateSuggestions = useCallback(
    (direction: 'up' | 'down') => {
      if (suggestions.length === 0 || isListClosed) return false;

      const maxVisible = UI_CONFIG.MAX_SUGGESTIONS;
      let newIndex = selectedIndex;

      if (direction === 'up') {
        newIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
      } else {
        newIndex = selectedIndex === suggestions.length - 1 ? 0 : selectedIndex + 1;
      }

      setSelectedIndex(newIndex);
      if (newIndex < startIndex) {
        setStartIndex(newIndex);
      } else if (newIndex >= startIndex + maxVisible) {
        setStartIndex(newIndex - maxVisible + 1);
      }
      return true;
    },
    [suggestions, isListClosed, selectedIndex, startIndex],
  );

  return {
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
  };
}
