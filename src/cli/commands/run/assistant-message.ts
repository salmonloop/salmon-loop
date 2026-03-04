import type { FlowMode } from '../../../core/types/execution.js';
import type { LoopResult } from '../../../core/types/loop.js';
import { text } from '../../locales/index.js';

export function buildRunAssistantMessage(params: { mode: FlowMode; result: LoopResult }): string {
  if (!params.result.success) return text.cli.chatFailed(params.result.reason);

  if (params.mode === 'review') return text.cli.chatReviewCompleted;
  if (params.mode === 'research') return text.cli.chatResearchCompleted;

  const changedFiles = params.result.changedFiles ?? [];
  if (changedFiles.length === 0) return text.cli.chatNoChanges;

  return text.cli.chatSuccess(changedFiles.join(', '));
}
