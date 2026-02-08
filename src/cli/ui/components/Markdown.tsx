// 1. MUST be at the very top to force all chalk instances to use color before any imports.
process.env.FORCE_COLOR = '3';
import chalk from 'chalk';
import { Text } from 'ink';
import { Marked } from 'marked';
import TerminalRendererOriginal from 'marked-terminal';
import React, { useMemo } from 'react';

import {
  DEFAULT_MARKDOWN_RENDER_MODE,
  DEFAULT_MARKDOWN_THEME,
  type MarkdownRenderMode,
  type MarkdownTheme,
} from '../../../core/config/types.js';
import { COLORS } from '../styles/theme.js';

if (chalk.level < 3) {
  chalk.level = 3;
}

const CODE_WRAP_SAFETY_MARGIN = 2;

const THEME_OVERRIDES: Record<MarkdownTheme, Record<string, unknown>> = {
  vivid: {
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    strong: chalk.yellowBright.bold,
    em: chalk.cyan.italic,
    codespan: chalk.yellowBright,
    code: chalk.yellowBright,
    link: chalk.blueBright,
    href: chalk.blueBright.underline,
    listitem: chalk.hex(COLORS.text.primary),
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    table: chalk.hex(COLORS.text.primary),
  },
  default: {
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow,
    code: chalk.yellow,
    link: chalk.blue,
    href: chalk.blue.underline,
    listitem: chalk.hex(COLORS.text.primary),
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    table: chalk.hex(COLORS.text.primary),
  },
};

export const Markdown = ({
  children,
  theme = DEFAULT_MARKDOWN_THEME,
  mode = DEFAULT_MARKDOWN_RENDER_MODE,
}: {
  children: string;
  theme?: MarkdownTheme;
  mode?: MarkdownRenderMode;
}) => {
  const parser = useMemo(() => {
    const m = new Marked();
    const RendererClass =
      (TerminalRendererOriginal as any).TerminalRenderer || TerminalRendererOriginal;
    const rendererInstance = new (RendererClass as any)({
      showSectionPrefix: false,
      unescape: true,
      color: true,
      width: process.stdout.columns || 80,
      ...(THEME_OVERRIDES[theme] ?? THEME_OVERRIDES.default),
    });

    if (mode === 'native') {
      m.use({ renderer: rendererInstance as any });
      return m;
    }

    const originalListitem = rendererInstance.listitem.bind(rendererInstance);
    rendererInstance.listitem = function (token: any) {
      if (isTightListItemWithCode(token)) {
        const previous = (rendererInstance as any).__inTightListItem;
        (rendererInstance as any).__inTightListItem = true;
        try {
          return originalListitem(token);
        } finally {
          (rendererInstance as any).__inTightListItem = previous;
        }
      }
      return originalListitem(token);
    };

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

    const renderCodeWithLineNumbers = function (
      this: any,
      token: any,
      infostring?: string,
      escaped?: boolean,
    ) {
      rendererInstance.options = this.options;
      rendererInstance.parser = this.parser;

      let codeText = '';
      let codeToken: { text: string; lang?: string; escaped?: boolean };

      if (token && typeof token === 'object') {
        codeText = String(token.text ?? '');
        const normalizedCodeText = normalizeCodeBlockForDisplay(codeText);
        codeToken = {
          text: normalizedCodeText,
          lang: token.lang ?? infostring,
          escaped: Boolean(token.escaped ?? escaped),
        };
        codeText = normalizedCodeText;
      } else {
        codeText = String(token ?? '');
        const normalizedCodeText = normalizeCodeBlockForDisplay(codeText);
        codeToken = {
          text: normalizedCodeText,
          lang: infostring,
          escaped: Boolean(escaped),
        };
        codeText = normalizedCodeText;
      }

      const logicalLines = codeText.endsWith('\n')
        ? codeText.slice(0, -1).split('\n')
        : codeText.split('\n');
      const lineCount = Math.max(logicalLines.length, 1);
      const numberWidth = String(lineCount).length;
      const availableWidth = resolveRendererWidth(this.options, rendererInstance.options);
      const maxContentWidth = Math.max(
        8,
        availableWidth - (numberWidth + 3) - CODE_WRAP_SAFETY_MARGIN,
      );
      const wrapped = wrapLogicalCodeLines(logicalLines, maxContentWidth);
      codeToken.text = wrapped.lines.join('\n');

      const base = String(rendererInstance.code(codeToken));
      const { lines: baseLines, suffix } = splitRenderedCodeLines(base);
      const normalizedBaseLines = removeRenderedCommonIndent(baseLines);
      let visualLineIndex = 0;
      let logicalLineIndex = 0;
      const continuationPrefix = `${' '.repeat(numberWidth)}${chalk.gray(' | ')}`;

      const numbered = normalizedBaseLines.map((line) => {
        if (visualLineIndex >= wrapped.firstChunkFlags.length) return line;
        const isFirstChunk = wrapped.firstChunkFlags[visualLineIndex];
        visualLineIndex += 1;
        if (!isFirstChunk) {
          return `${continuationPrefix}${line}`;
        }
        const number = String(logicalLineIndex + 1).padStart(numberWidth, ' ');
        logicalLineIndex += 1;
        return `${chalk.gray(number)}${chalk.gray(' | ')}${line}`;
      });

      const numberedBlock = `${numbered.join('\n')}${suffix}`;
      if (
        (rendererInstance as any).__inTightListItem &&
        numberedBlock.length > 0 &&
        !numberedBlock.startsWith('\n')
      ) {
        return `\n${numberedBlock}`;
      }
      return numberedBlock;
    };

    const cleanRenderer: any = Object.create(null);
    for (const hook of standardHooks) {
      if (typeof rendererInstance[hook] !== 'function') continue;

      if (hook === 'code') {
        cleanRenderer.code = renderCodeWithLineNumbers;
        continue;
      }

      if (hook === 'text') {
        cleanRenderer.text = function (this: any, token: any) {
          rendererInstance.options = this.options;
          rendererInstance.parser = this.parser;
          if (token && typeof token === 'object' && Array.isArray(token.tokens)) {
            return this.parser.parseInline(token.tokens);
          }
          return rendererInstance.text(token);
        };
        continue;
      }

      cleanRenderer[hook] = function (this: any, ...args: any[]) {
        rendererInstance.options = this.options;
        rendererInstance.parser = this.parser;
        return rendererInstance[hook](...args);
      };
    }

    m.use({ renderer: cleanRenderer });
    return m;
  }, [mode, theme]);

  const content = useMemo(() => {
    try {
      if (!children) return '';
      if (mode === 'native') {
        const result = parser.parse(children);
        return typeof result === 'string' ? result.trimEnd() : String(result).trimEnd();
      }
      const preparedChildren = prepareMarkdownInput(children);
      if (!preparedChildren) return '';
      const result = parser.parse(preparedChildren);
      const rendered = typeof result === 'string' ? result : String(result);
      return compactRenderedSpacing(rendered).trimEnd();
    } catch (_error) {
      return children;
    }
  }, [children, mode, parser]);

  return <Text>{content}</Text>;
};

function prepareMarkdownInput(content: string): string {
  const lines = trimOuterEmptyLines(content.split('\n'));
  if (lines.length === 0) return '';

  const minIndent = lines.reduce((min, line) => {
    if (!line.trim()) return min;
    const match = line.match(/^[ \t]*/);
    const indent = match ? match[0].replace(/\t/g, '    ').length : 0;
    return Math.min(min, indent);
  }, Infinity);

  if (minIndent === Infinity || minIndent <= 0) {
    return lines.join('\n');
  }

  return lines.map((line) => removeIndent(line, minIndent)).join('\n');
}

function trimOuterEmptyLines(lines: string[]): string[] {
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length === 0) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return [];
  return lines.slice(first, last + 1);
}

function removeIndent(line: string, amount: number): string {
  let index = 0;
  let width = 0;
  while (index < line.length && width < amount) {
    const ch = line[index];
    if (ch === ' ') {
      width += 1;
      index += 1;
      continue;
    }
    if (ch === '\t') {
      width += 4;
      index += 1;
      continue;
    }
    break;
  }
  return line.slice(index);
}

function normalizeCodeBlockForDisplay(code: string): string {
  const lines = code.split('\n');
  const minIndent = lines.reduce((min, line) => {
    if (!line.trim()) return min;
    const match = line.match(/^[ \t]*/);
    const indent = match ? match[0].replace(/\t/g, '    ').length : 0;
    return Math.min(min, indent);
  }, Infinity);

  if (minIndent === Infinity || minIndent <= 0) {
    return code;
  }

  return lines.map((line) => removeIndent(line, minIndent)).join('\n');
}

function isTightListItemWithCode(token: any): boolean {
  if (!token || typeof token !== 'object') return false;
  if (token.loose) return false;
  if (!Array.isArray(token.tokens)) return false;
  return token.tokens.some((item: any) => item && item.type === 'code');
}

function splitRenderedCodeLines(code: string): { lines: string[]; suffix: string } {
  const suffixMatch = code.match(/\n+$/);
  const suffix = suffixMatch ? suffixMatch[0] : '';
  const body = suffix.length > 0 ? code.slice(0, -suffix.length) : code;
  if (!body) return { lines: [''], suffix };
  return { lines: body.split('\n'), suffix };
}

function removeRenderedCommonIndent(lines: string[]): string[] {
  const minIndent = lines.reduce((min, line) => {
    if (!line.trim()) return min;
    const match = line.match(/^[ \t]*/);
    const indent = match ? match[0].replace(/\t/g, '    ').length : 0;
    return Math.min(min, indent);
  }, Infinity);

  if (minIndent === Infinity || minIndent <= 0) return lines;
  return lines.map((line) => removeIndent(line, minIndent));
}

function resolveRendererWidth(
  markedOptions: Record<string, unknown> | undefined,
  rendererOptions: Record<string, unknown> | undefined,
): number {
  const markedWidth = markedOptions?.width;
  if (typeof markedWidth === 'number' && Number.isFinite(markedWidth) && markedWidth > 0) {
    return markedWidth;
  }
  const rendererWidth = rendererOptions?.width;
  if (typeof rendererWidth === 'number' && Number.isFinite(rendererWidth) && rendererWidth > 0) {
    return rendererWidth;
  }
  return process.stdout.columns || 80;
}

function wrapLogicalCodeLines(
  logicalLines: string[],
  maxContentWidth: number,
): { lines: string[]; firstChunkFlags: boolean[] } {
  const lines: string[] = [];
  const firstChunkFlags: boolean[] = [];

  for (const logicalLine of logicalLines) {
    const chunks = wrapPlainCodeLine(logicalLine, maxContentWidth);
    for (let index = 0; index < chunks.length; index += 1) {
      lines.push(chunks[index]);
      firstChunkFlags.push(index === 0);
    }
  }

  return { lines, firstChunkFlags };
}

function wrapPlainCodeLine(line: string, maxContentWidth: number): string[] {
  if (maxContentWidth <= 0) return [line];
  if (line.length === 0 || getDisplayWidth(line) <= maxContentWidth) return [line];

  const chunks: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const ch of line) {
    const width = getCharacterDisplayWidth(ch);
    if (currentWidth + width > maxContentWidth && current.length > 0) {
      chunks.push(current);
      current = '';
      currentWidth = 0;
    }
    current += ch;
    currentWidth += width;
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }

  return chunks;
}

function getDisplayWidth(input: string): number {
  let width = 0;
  for (const ch of input) {
    width += getCharacterDisplayWidth(ch);
  }
  return width;
}

function getCharacterDisplayWidth(ch: string): number {
  if (ch === '\t') return 4;
  const codePoint = ch.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (isZeroWidthCodePoint(codePoint)) return 0;
  if (isFullWidthCodePoint(codePoint)) return 2;
  return 1;
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  );
}

function isFullWidthCodePoint(codePoint: number): boolean {
  if (codePoint < 0x1100) return false;
  return (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
    (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function compactRenderedSpacing(content: string): string {
  let output = '';
  let newlineCount = 0;
  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    if (ch === '\n') {
      newlineCount += 1;
      if (newlineCount <= 2) {
        output += ch;
      }
      continue;
    }
    newlineCount = 0;
    output += ch;
  }
  return output;
}
