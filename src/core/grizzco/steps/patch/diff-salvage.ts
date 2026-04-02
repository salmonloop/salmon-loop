import { extractAndValidatePatch, type ValidatedPatchDiff } from './diff-normalization.js';

const SALVAGEABLE_PATCH_CODES = new Set(['LLM_PATCH_NOT_UNIFIED_DIFF', 'LLM_PATCH_EMPTY']);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isSalvageablePatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const llmCode = (error as { llmCode?: unknown }).llmCode;
  return typeof llmCode === 'string' && SALVAGEABLE_PATCH_CODES.has(llmCode);
}

export interface PatchSalvageResult extends ValidatedPatchDiff {
  rawContent: string;
}

export interface PatchSalvageArgs {
  initialError: unknown;
  rawContent: string;
  plannedFiles: string[];
  repair: (args: { badContent: string }) => Promise<{ content?: string }>;
  onAttempt?: (payload: { reason: string; badContentLength: number }) => void;
  onResult?: (payload: { ok: boolean; contentLength: number; error?: string }) => void;
}

export async function salvagePatchDiff(args: PatchSalvageArgs): Promise<PatchSalvageResult | null> {
  if (!isSalvageablePatchError(args.initialError)) return null;

  args.onAttempt?.({
    reason: errorMessage(args.initialError),
    badContentLength: args.rawContent.length,
  });

  const repaired = await args.repair({ badContent: args.rawContent });
  const repairedContent = repaired.content || '';

  try {
    const validated = extractAndValidatePatch({
      rawContent: repairedContent,
      plannedFiles: args.plannedFiles,
    });
    args.onResult?.({
      ok: true,
      contentLength: repairedContent.length,
    });
    return {
      ...validated,
      rawContent: repairedContent,
    };
  } catch (salvageError) {
    args.onResult?.({
      ok: false,
      contentLength: repairedContent.length,
      error: errorMessage(salvageError).slice(0, 400),
    });
    throw args.initialError;
  }
}
