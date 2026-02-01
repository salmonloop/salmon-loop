import { Text } from 'ink';
import { Marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import React, { useMemo } from 'react';

export const Markdown = ({ children }: { children: string }) => {
  // 1. 实例化放到组件内部（Lazy Initialization）
  // 2. 使用 Marked 类创建隔离实例，避免污染全局
  // 3. 使用 useMemo 缓存实例，避免重复创建
  const parser = useMemo(() => {
    const m = new Marked();
    m.use({ renderer: new TerminalRenderer() as any });
    return m;
  }, []);

  const content = useMemo(() => {
    try {
      if (!children) return '';
      // 使用局部实例进行解析
      const result = parser.parse(children);
      return typeof result === 'string' ? result.trim() : '';
    } catch (_) {
      return children || '';
    }
  }, [children, parser]);

  return <Text>{content}</Text>;
};
