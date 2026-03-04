import type { LoopResult } from '../types/runtime.js';

export const EXIT_CODES = {
  success: 0,
  failure: 1,
  cancelled: 130,
} as const;

export function getExitCode(result: Partial<LoopResult>): number {
  if (result.reason === 'Operation cancelled by user') return EXIT_CODES.cancelled;
  return result.success ? EXIT_CODES.success : EXIT_CODES.failure;
}
