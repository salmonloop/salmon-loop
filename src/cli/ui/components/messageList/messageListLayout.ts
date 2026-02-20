import type { UiLogMode } from '../../../../core/config/types.js';
import { UI_CONFIG } from '../../config.js';
import type { QueueMessage } from '../../store/types.js';

export function computeStreamingMaxLines(opts: {
  terminalHeight: number | undefined;
  logMode: UiLogMode;
}): number {
  const height = opts.terminalHeight || UI_CONFIG.DEFAULT_HEIGHT;
  const reservedRows = 10;
  const raw = height - reservedRows;

  const min = opts.logMode === 'debug' ? 8 : opts.logMode === 'normal' ? 4 : 1;
  const max = opts.logMode === 'debug' ? 24 : opts.logMode === 'normal' ? 6 : 3;

  return Math.max(min, Math.min(max, raw));
}

export function computeContainerWidth(terminalWidth: number | undefined): number {
  const width = terminalWidth || UI_CONFIG.DEFAULT_WIDTH;
  const padded = Math.max(0, width - UI_CONFIG.MESSAGE_AREA_PADDING_X * 2);
  return Math.min(width, Math.max(10, padded));
}

export function computeSeparatorLine(containerWidth: number): string {
  return '─'.repeat(Math.max(10, containerWidth - 2));
}

export function formatQueuePreview(content: string): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= UI_CONFIG.QUEUE_PREVIEW_MAX_CHARS) return singleLine;
  return singleLine.slice(0, UI_CONFIG.QUEUE_PREVIEW_MAX_CHARS - 3) + '...';
}

export function orderQueueMessages(queueMessages: QueueMessage[]): QueueMessage[] {
  return [...queueMessages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
