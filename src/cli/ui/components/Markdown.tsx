import { Text } from 'ink';
import { Marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import React, { useMemo } from 'react';

export const Markdown = ({ children }: { children: string }) => {
  // 1. Place instantiation inside the component (Lazy Initialization)
  // 2. Use the Marked class to create an isolated instance to avoid polluting the global scope
  // 3. Use useMemo to cache the instance and avoid redundant creation
  const parser = useMemo(() => {
    const m = new Marked();
    m.use({ renderer: new TerminalRenderer() as any });
    return m;
  }, []);

  const content = useMemo(() => {
    try {
      if (!children) return '';
      // Use local instance for parsing
      const result = parser.parse(children);
      return typeof result === 'string' ? result.trim() : '';
    } catch (_) {
      return children || '';
    }
  }, [children, parser]);

  return <Text>{content}</Text>;
};
