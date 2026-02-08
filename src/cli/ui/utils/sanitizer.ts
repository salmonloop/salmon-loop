import { UI_CONFIG } from '../config.js';
import { normalizeLegacyType } from '../store/types.js';

export interface UIEvent {
  type?: string;
  content?: string;
  message?: string;
  id?: string;
  timestamp?: Date;
  [key: string]: any;
}

/**
 * Sanitizes and truncates messages to prevent technical detail leaks (e.g. 429 errors)
 * and UI breakage from massive strings.
 *
 * Strictly follows functional purity and captures both raw content and messages.
 */
export function sanitizeMessage(ev: UIEvent): string {
  let safeMessage = String(ev.content || ev.message || '');

  // 1. Block massive SDK error objects/stacks and 429 details
  const isAiError = /RetryError|APICallError|statusCode: 429|Rate limit exceeded|ZodError|ValidationError|TypeError.*at\s+/i.test(
    safeMessage,
  );

  // 2. Filter out stack traces (security & UX)
  // Enhanced detection: check for any stack trace indicators
  // Also detect JSON fragments mixed with stack traces (e.g., Zod errors)
  const hasStackTrace = /^\s*at\s+/m.test(safeMessage) ||
                        /\s+at\s+\w+.*\(/m.test(safeMessage) ||
                        safeMessage.includes('node_modules') ||
                        safeMessage.includes('file:///') ||
                        /:\d+:\d+\)$/m.test(safeMessage) || // matches line:col) at end of lines
                        (/^\s*[\]\},]/.test(safeMessage) && /\s+at\s+/.test(safeMessage)); // JSON fragments + stack traces

  if (isAiError || hasStackTrace) {
    const lastErrorMatch = safeMessage.match(/Last error:\s*([^\n{]+)/i);
    const jsonMessageMatch = safeMessage.match(/"message"\s*:\s*"([^"]+)"/i);
    const plainMessageMatch = safeMessage.match(/message:\s*'([^']+)'/i);

    // Extract just the error type and message, aggressively filter stack traces
    const errorLines = safeMessage.split('\n').filter(line => {
      const trimmed = line.trim();
      // Reject empty lines, stack traces, file paths
      if (!trimmed) return false;
      if (trimmed.startsWith('at ')) return false;
      if (trimmed.includes('node_modules')) return false;
      if (trimmed.includes('file:///')) return false;
      if (/:\d+:\d+\)?$/.test(trimmed)) return false; // line:col at end
      if (/^\w+Error:/.test(trimmed) && trimmed.length > 200) return false; // suspiciously long error line
      return true;
    });

    if (lastErrorMatch) {
      safeMessage = `Error: ${lastErrorMatch[1].trim()}`;
    } else if (jsonMessageMatch) {
      safeMessage = `Error: ${jsonMessageMatch[1]}`;
    } else if (plainMessageMatch) {
      safeMessage = `Error: ${plainMessageMatch[1]}`;
    } else if (errorLines.length > 0) {
      // Use first non-stack-trace line, clean up error type prefix
      let cleanLine = errorLines[0]
        .replace(/^(ZodError|ValidationError|TypeError|Error|APICallError|RetryError):\s*/i, '')
        .trim()
        .substring(0, 150);

      // If line is still too technical or empty, use generic message
      if (!cleanLine || cleanLine.length < 3 || /^[\[\{]/.test(cleanLine)) {
        safeMessage = 'An error occurred. Please try again or rephrase your request.';
      } else {
        safeMessage = cleanLine.toLowerCase().includes('error')
          ? cleanLine
          : `Error: ${cleanLine}`;
      }
    } else {
      // All lines were stack traces - use generic message
      safeMessage = 'An error occurred. Please try again or rephrase your request.';
    }
  }

  // 2. Strict length limit for UI stability
  const hasStructure = safeMessage.includes('```') || safeMessage.includes('`');
  const isConversation = ev.type === 'ai' || ev.type === 'assistant' || ev.type === 'user';
  const limit = isConversation
    ? UI_CONFIG.CONVERSATION_CONTENT_LIMIT
    : hasStructure
      ? UI_CONFIG.STRUCTURED_CONTENT_LIMIT
      : UI_CONFIG.LOG_CHAR_LIMIT;

  if (safeMessage.length > limit) {
    safeMessage = safeMessage.substring(0, limit - 3) + '...';
  }

  return safeMessage;
}

/**
 * Prepares a sanitized message payload for the UI store.
 */
export function prepareMessagePayload(ev: UIEvent) {
  const sanitizedContent = sanitizeMessage(ev);

  // Normalize legacy types (e.g. 'ai' -> 'assistant')
  const safeType = normalizeLegacyType(ev.type || 'system');

  return {
    ...ev,
    id: ev.id || `sys-${Math.random().toString(36).substring(7)}`,
    type: safeType,
    content: sanitizedContent,
    timestamp: ev.timestamp || new Date(),
  };
}
