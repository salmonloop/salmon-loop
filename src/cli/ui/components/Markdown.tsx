// 1. MUST be at the very top to force all chalk instances to use color before any imports
process.env.FORCE_COLOR = '3';
import chalk from 'chalk';
import { Text } from 'ink';
import { Marked } from 'marked';
import TerminalRendererOriginal from 'marked-terminal';
import React, { useMemo } from 'react';

// Force local chalk to level 3 (Truecolor)
if (chalk.level < 3) {
  chalk.level = 3;
}

export const Markdown = ({ children }: { children: string }) => {
  const parser = useMemo(() => {
    const m = new Marked();

    // v7.3.0 logic: determine the correct class constructor
    const RendererClass =
      (TerminalRendererOriginal as any).TerminalRenderer || TerminalRendererOriginal;

    // 🛡️ DCAP 终极加固：手动注入支持彩色的样式函数
    // 我们不再相信依赖包的自动探测（它在隔离环境下极其脆弱），直接注入我们确定的全彩样式。
    const rendererInstance = new (RendererClass as any)({
      showSectionPrefix: false,
      unescape: true,
      color: true,
      width: process.stdout.columns || 80,
      // 显式映射核心样式，确保颜色穿透代理层
      heading: chalk.green.bold,
      firstHeading: chalk.magenta.underline.bold,
      strong: chalk.bold,
      em: chalk.italic,
      codespan: chalk.yellow,
      code: chalk.yellow,
      link: chalk.blue,
      href: chalk.blue.underline,
      listitem: chalk.reset,
      blockquote: chalk.gray.italic,
      html: chalk.gray,
      table: chalk.reset,
    });

    const standardHooks = [
      'blockquote',
      'br',
      'checkbox',
      'code',
      'codespan',
      'del',
      'em',
      'heading',
      'hr',
      'html',
      'image',
      'link',
      'list',
      'listitem',
      'paragraph',
      'strong',
      'table',
      'tablecell',
      'tablerow',
      'text',
    ];

    // 物理方法映射：只暴露标准方法，屏蔽 'o', 'textLength' 等杂质，防止 marked v17 崩溃
    const cleanRenderer: any = Object.create(null);
    for (const hook of standardHooks) {
      if (typeof rendererInstance[hook] === 'function') {
        cleanRenderer[hook] = function (...args: any[]) {
          // Sync parser/options so marked-terminal can access this.parser safely.
          rendererInstance.options = (this as any).options;
          rendererInstance.parser = (this as any).parser;
          return rendererInstance[hook](...args);
        };
      }
    }

    m.use({ renderer: cleanRenderer });
    return m;
  }, []);

  const content = useMemo(() => {
    try {
      if (!children) return '';

      // Robust Dedent: 确保符号对齐行首解析，防止被误判为代码块
      const lines = children.split('\n');
      let firstValidLine = -1;
      let lastValidLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().length > 0) {
          if (firstValidLine === -1) firstValidLine = i;
          lastValidLine = i;
        }
      }
      if (firstValidLine === -1) return '';

      const relevantLines = lines.slice(firstValidLine, lastValidLine + 1);
      const minIndent = relevantLines.reduce((min, line) => {
        if (line.trim().length === 0) return min;
        const match = line.match(/^(\s*)/);
        return Math.min(min, match ? match[1].length : 0);
      }, Infinity);

      const dedentedChildren =
        minIndent > 0 && minIndent !== Infinity
          ? relevantLines.map((line) => line.substring(minIndent)).join('\n')
          : relevantLines.join('\n');

      const result = parser.parse(dedentedChildren);
      return typeof result === 'string' ? result.trimEnd() : String(result).trimEnd();
    } catch (_err) {
      return children;
    }
  }, [children, parser]);

  return <Text>{content}</Text>;
};
