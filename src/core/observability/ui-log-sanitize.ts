import { LIMITS } from '../config/limits.js';
import type { LoopEvent } from '../types/index.js';
import { sanitizeErrorMessage } from '../utils/sanitizer.js';

const ESC = '\u001B';
const ANSI_REGEX = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

// Heuristic: if a log line looks like a dumped SDK error/object, do not let it through to GUI.
const TECHNICAL_DUMP_HINT_REGEX =
  /(AI_RetryError|APICallError|RetryError|ZodError|requestBodyValues|responseBody|\[Symbol\(vercel\.ai\.error)/i;

function stripControlChars(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    result += code < 32 || code === 127 ? ' ' : text[i];
  }
  return result;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 3)) + '...';
}

export function sanitizeUiLogMessage(
  message: string,
  level: Extract<LoopEvent, { type: 'log' }>['level'],
): string {
  let msg = String(message ?? '');
  msg = msg.replace(ANSI_REGEX, '');

  // If it looks like a technical dump, hide it aggressively.
  if (TECHNICAL_DUMP_HINT_REGEX.test(msg)) {
    return 'ERR_TECHNICAL_DETAILS_HIDDEN';
  }

  // For warn/error we apply stricter sanitization.
  if (level === 'warn' || level === 'error') {
    msg = sanitizeErrorMessage(msg);
  }

  msg = stripControlChars(msg);
  msg = truncate(msg, LIMITS.maxLogLength);
  return msg;
}
