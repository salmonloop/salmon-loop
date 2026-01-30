import type { Context, RelatedFileContext } from '../../types.js';
import { outlineSource } from '../ast/source-outline.js';

import { stripJsLikeComments } from './js-like-comments.js';
import { normalizeWhitespace } from './whitespace.js';

export interface SmartCompressionOptions {
  budgetChars?: number;
}

function shouldPreserveJSDoc(budgetChars?: number): boolean {
  if (budgetChars === undefined) return false;
  return budgetChars >= 30_000;
}

function compressRelatedFile(
  file: RelatedFileContext,
  options: SmartCompressionOptions,
): RelatedFileContext {
  if (!file.content) return file;
  if (file.mode === 'outline') {
    return {
      ...file,
      content: normalizeWhitespace(file.content, { maxConsecutiveBlankLines: 1 }),
    };
  }

  const preserveJSDoc = shouldPreserveJSDoc(options.budgetChars);
  const commentStripped = stripJsLikeComments(file.content, { preserveJSDoc });
  const normalized = normalizeWhitespace(commentStripped, { maxConsecutiveBlankLines: 1 });

  // For unusually large "full" related files, downgrade to outline to avoid wasting budget.
  if (normalized.length > 12_000) {
    const outline = outlineSource(file.content);
    const outlineText = normalizeWhitespace(outline, { maxConsecutiveBlankLines: 1 });
    return {
      ...file,
      mode: 'outline',
      content: outlineText,
      outline: undefined,
    };
  }

  return { ...file, content: normalized };
}

function compressRelatedFiles(
  relatedFiles: RelatedFileContext[] | undefined,
  options: SmartCompressionOptions,
): RelatedFileContext[] | undefined {
  if (!relatedFiles) return relatedFiles;
  return relatedFiles.map((f) => compressRelatedFile(f, options));
}

function compressDiffText(value: string): string {
  return normalizeWhitespace(value, { maxConsecutiveBlankLines: 1 });
}

export function applySmartCompression(
  context: Context,
  options: SmartCompressionOptions = {},
): Context {
  return {
    ...context,
    primaryText: context.primaryText,
    relatedFiles: compressRelatedFiles(context.relatedFiles, options),
    rgSnippets: context.rgSnippets.map((s) => ({
      ...s,
      content: normalizeWhitespace(s.content ?? '', { maxConsecutiveBlankLines: 0 }),
    })),
    gitDiff: context.gitDiff ? compressDiffText(context.gitDiff) : context.gitDiff,
    stagedDiff: context.stagedDiff ? compressDiffText(context.stagedDiff) : context.stagedDiff,
    unstagedDiff: context.unstagedDiff
      ? compressDiffText(context.unstagedDiff)
      : context.unstagedDiff,
    untrackedDiff: context.untrackedDiff
      ? compressDiffText(context.untrackedDiff)
      : context.untrackedDiff,
  };
}
