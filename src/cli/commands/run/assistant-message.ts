import type { LoopResult, FlowMode } from '../../../core/types/index.js';
import { text } from '../../locales/index.js';

export function buildRunAssistantMessage(params: { mode: FlowMode; result: LoopResult }): string {
  if (!params.result.success) return text.cli.chatFailed(params.result.reason);

  if (params.mode === 'review') return text.cli.chatReviewCompleted;

  const changedFiles = params.result.changedFiles ?? [];
  if (changedFiles.length === 0) return text.cli.chatNoChanges;

  return text.cli.chatSuccess(changedFiles.join(', '));
}
