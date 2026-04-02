import { text } from '../../../../locales/index.js';
import { wrapPatchEmpty, wrapPatchInvalid, wrapPatchNotUnifiedDiff } from '../../../llm/errors.js';
import { extractUnifiedDiffFromLLMContent } from '../../../llm/utils.js';
import { normalizeDiff, validateDiff, type DiffMeta } from '../../../patch/diff.js';
import { DiffValidationError } from '../../../types/errors.js';

export interface ValidatedPatchDiff {
  patch: string;
  normalizedPatch: string;
  diffMeta: DiffMeta;
}

const isCanonicalDiffHeader = (diffText: string): boolean =>
  diffText.trimStart().startsWith('diff --git ');

export function assertCanonicalDiffHeader(diffText: string) {
  if (!diffText.trim()) {
    throw wrapPatchEmpty();
  }
  if (!isCanonicalDiffHeader(diffText)) {
    throw wrapPatchNotUnifiedDiff();
  }
}

export function rewriteUniqueBasenameDiffPaths(diffText: string, plannedFiles: string[]): string {
  if (plannedFiles.length === 0) return diffText;

  const basenameMap = new Map<string, string | null>();
  for (const file of plannedFiles.map((item) => item.replace(/\\/g, '/'))) {
    const basename = file.split('/').at(-1);
    if (!basename) continue;
    const existing = basenameMap.get(basename);
    if (existing === undefined) {
      basenameMap.set(basename, file);
      continue;
    }
    if (existing !== file) {
      basenameMap.set(basename, null);
    }
  }

  const resolvePath = (candidate: string) => {
    const normalized = candidate.replace(/\\/g, '/');
    if (normalized === 'dev/null' || normalized.includes('/')) return candidate;
    const mapped = basenameMap.get(normalized);
    return mapped ?? candidate;
  };

  return diffText
    .replace(
      /^diff --git a\/(.+?) b\/(.+)$/gm,
      (_, left, right) => `diff --git a/${resolvePath(left)} b/${resolvePath(right)}`,
    )
    .replace(/^--- a\/(.+)$/gm, (_, left) => `--- a/${resolvePath(left)}`)
    .replace(/^\+\+\+ b\/(.+)$/gm, (_, right) => `+++ b/${resolvePath(right)}`);
}

export function validatePatchDiff(diffText: string): ValidatedPatchDiff {
  assertCanonicalDiffHeader(diffText);

  const normalizedPatch = normalizeDiff(diffText);
  try {
    const diffMeta = validateDiff(normalizedPatch);
    return {
      patch: diffText,
      normalizedPatch,
      diffMeta,
    };
  } catch (error) {
    if (error instanceof DiffValidationError) {
      if (error.message === text.diff.notUnifiedFormat) throw wrapPatchNotUnifiedDiff();
      if (error.message.startsWith(text.llm.patchEmpty())) throw wrapPatchEmpty();
      throw wrapPatchInvalid(error.message);
    }
    throw error;
  }
}

export function extractAndValidatePatch(args: {
  rawContent: string;
  plannedFiles: string[];
}): ValidatedPatchDiff {
  const patch = rewriteUniqueBasenameDiffPaths(
    extractUnifiedDiffFromLLMContent(args.rawContent),
    args.plannedFiles,
  );
  return validatePatchDiff(patch);
}
