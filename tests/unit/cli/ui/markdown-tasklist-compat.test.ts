import { describe, it, expect } from 'bun:test';
import chalk from 'chalk';
import { Marked } from 'marked';
import TerminalRendererOriginal from 'marked-terminal';

import { __applyMarkedTerminalTaskListCompat } from '../../../../src/cli/ui/components/Markdown.js';

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('Markdown task list compat', () => {
  it('renders task list items with a single checkbox', () => {
    if (chalk.level < 3) chalk.level = 3;

    const m = new Marked();
    const RendererClass =
      (TerminalRendererOriginal as any).TerminalRenderer || TerminalRendererOriginal;
    const rendererInstance = new (RendererClass as any)({
      showSectionPrefix: false,
      unescape: true,
      color: false,
      width: 80,
    });

    __applyMarkedTerminalTaskListCompat(m);

    const hooks = [
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

    const cleanRenderer: any = Object.create(null);
    for (const hook of hooks) {
      if (typeof rendererInstance[hook] !== 'function') continue;
      cleanRenderer[hook] = function (this: any, ...args: any[]) {
        rendererInstance.options = this.options;
        rendererInstance.parser = this.parser;
        return rendererInstance[hook](...args);
      };
    }

    m.use({ renderer: cleanRenderer });

    const rendered = String(m.parse('- [x] Add // test'));
    const clean = stripAnsi(rendered);
    const matches = clean.match(/\[[xX]\]/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
