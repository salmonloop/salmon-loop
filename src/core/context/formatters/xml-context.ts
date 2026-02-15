import { text } from '../../../locales/index.js';
import type { Context, RelatedFileContext, RipgrepResult } from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';

const ANALYSIS_LIMITS = {
  maxParseErrorChars: 4000,
  maxSyntaxErrors: 50,
  maxNotes: 10,
  maxNoteChars: 500,
} as const;

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeCdata(text: string): string {
  return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

function cdataBlock(content: string, indent: string): string {
  const safe = escapeCdata(content);
  return `${indent}<![CDATA[\n${safe}\n${indent}]]>`;
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
}

function markSymbolsInText(context: Context): string | undefined {
  const primaryText = context.primaryText;
  const symbols = context.symbols;
  if (!primaryText) return primaryText;
  if (!symbols || symbols.length === 0) return primaryText;

  const lines = primaryText.split('\n');
  const sortedSymbols = [...symbols].sort((a, b) => {
    if (a.location.start.line !== b.location.start.line) {
      return b.location.start.line - a.location.start.line;
    }
    return b.location.start.column - a.location.start.column;
  });

  for (const symbol of sortedSymbols) {
    const lineIdx = symbol.location.start.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    const marker = symbol.kind === 'definition' ? '' : text.symbols.info;
    if (marker && !lines[lineIdx].endsWith(marker)) {
      lines[lineIdx] += marker;
    }
  }

  return lines.join('\n');
}

function renderPrimaryFile(context: Context): string[] {
  const out: string[] = [];
  if (!context.primaryText) return out;

  const primaryPath = context.primaryFile || 'Selection';
  out.push(`  <primary_file path="${escapeXmlAttr(primaryPath)}">`);
  out.push(cdataBlock(markSymbolsInText(context) ?? '', '    '));
  out.push('  </primary_file>');
  return out;
}

function renderManifest(context: Context): string[] {
  const out: string[] = [];
  const targets = context.targets;
  if (!targets || targets.length === 0) return out;

  out.push('  <manifest>');
  out.push('    <targets>');
  for (const t of targets) {
    const evidenceAttr = t.evidence ? ` evidence="${escapeXmlAttr(t.evidence)}"` : '';
    out.push(
      `      <target path="${escapeXmlAttr(normalizePath(t.path))}" reason="${escapeXmlAttr(t.reason)}" confidence="${escapeXmlAttr(t.confidence)}"${evidenceAttr} />`,
    );
  }
  out.push('    </targets>');
  out.push('  </manifest>');

  return out;
}

function renderAnalysis(context: Context): string[] {
  const out: string[] = [];
  const ast = context.analysis?.ast;
  if (!ast) return out;

  out.push('  <analysis>');
  out.push('    <ast>');

  if (ast.languageId) {
    out.push(`      <language id="${escapeXmlAttr(ast.languageId)}" />`);
  }

  if (ast.parseError) {
    out.push('      <parse_error>');
    out.push(
      cdataBlock(truncateText(ast.parseError, ANALYSIS_LIMITS.maxParseErrorChars), '        '),
    );
    out.push('      </parse_error>');
  }

  if (Array.isArray(ast.syntaxErrors) && ast.syntaxErrors.length > 0) {
    out.push('      <syntax_errors>');
    for (const e of ast.syntaxErrors.slice(0, ANALYSIS_LIMITS.maxSyntaxErrors)) {
      out.push(
        `        <error line="${e.line}" column="${e.column}" type="${escapeXmlAttr(e.type)}">`,
      );
      out.push(cdataBlock(e.text, '          '));
      out.push('        </error>');
    }
    out.push('      </syntax_errors>');
  }

  if (Array.isArray(ast.notes) && ast.notes.length > 0) {
    out.push('      <notes>');
    for (const note of ast.notes.slice(0, ANALYSIS_LIMITS.maxNotes)) {
      out.push('        <note>');
      out.push(cdataBlock(truncateText(note, ANALYSIS_LIMITS.maxNoteChars), '          '));
      out.push('        </note>');
    }
    out.push('      </notes>');
  }

  out.push('    </ast>');
  out.push('  </analysis>');

  return out;
}

function renderRelatedFiles(relatedFiles: RelatedFileContext[] | undefined): string[] {
  const out: string[] = [];
  if (!relatedFiles || relatedFiles.length === 0) return out;

  out.push('  <related_files>');
  for (const file of relatedFiles) {
    const reason = file.kind;
    out.push(
      `    <file path="${escapeXmlAttr(file.path)}" reason="${escapeXmlAttr(reason)}" mode="${escapeXmlAttr(file.mode)}">`,
    );
    out.push(cdataBlock(file.content ?? '', '      '));
    out.push('    </file>');
  }
  out.push('  </related_files>');
  return out;
}

function renderSnippets(snippets: RipgrepResult[]): string[] {
  const out: string[] = [];
  if (!snippets || snippets.length === 0) return out;

  out.push('  <code_snippets>');
  for (const snippet of snippets) {
    out.push(
      `    <snippet file="${escapeXmlAttr(normalizePath(snippet.file))}" line="${snippet.line}">`,
    );
    out.push(cdataBlock(snippet.content ?? '', '      '));
    out.push('    </snippet>');
  }
  out.push('  </code_snippets>');
  return out;
}

function renderDiffs(context: Context): string[] {
  const out: string[] = [];

  if (context.stagedDiff) {
    out.push('  <staged_diff>');
    out.push(cdataBlock(context.stagedDiff, '    '));
    out.push('  </staged_diff>');
  }

  if (context.unstagedDiff) {
    out.push('  <unstaged_diff>');
    out.push(cdataBlock(context.unstagedDiff, '    '));
    out.push('  </unstaged_diff>');
  }

  if (context.gitDiff && !context.stagedDiff && !context.unstagedDiff) {
    out.push('  <git_diff>');
    out.push(cdataBlock(context.gitDiff, '    '));
    out.push('  </git_diff>');
  }

  if (context.untrackedDiff) {
    out.push('  <untracked_diff>');
    out.push(cdataBlock(context.untrackedDiff, '    '));
    out.push('  </untracked_diff>');
  }

  return out;
}

function renderUntrackedFiles(files: string[] | undefined): string[] {
  const out: string[] = [];
  if (!files || files.length === 0) return out;

  out.push('  <untracked_files>');
  for (const file of files) {
    out.push(`    <file path="${escapeXmlAttr(normalizePath(file))}" />`);
  }
  out.push('  </untracked_files>');
  return out;
}

export function formatContextForXmlPrompt(context: Context): string {
  const out: string[] = [];
  out.push('<context>');

  out.push(...renderManifest(context));
  out.push(...renderAnalysis(context));
  out.push(...renderPrimaryFile(context));
  out.push(...renderRelatedFiles(context.relatedFiles));
  out.push(...renderSnippets(context.rgSnippets));
  out.push(...renderDiffs(context));
  out.push(...renderUntrackedFiles(context.untrackedFiles));

  out.push('</context>');
  return out.join('\n');
}
