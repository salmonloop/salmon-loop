import { UI_CONFIG } from '../config.js';

export interface UIEvent {
  type?: 'user' | 'ai' | 'system' | 'welcome' | string;
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
  const isAiError = /RetryError|APICallError|statusCode: 429|Rate limit exceeded/i.test(
    safeMessage,
  );

  if (isAiError) {
    const lastErrorMatch = safeMessage.match(/Last error:\s*([^\n{]+)/i);
    const jsonMessageMatch = safeMessage.match(/"message"\s*:\s*"([^"]+)"/i);
    const plainMessageMatch = safeMessage.match(/message:\s*'([^']+)'/i);

    if (lastErrorMatch) {
      safeMessage = `Error: ${lastErrorMatch[1].trim()}`;
    } else if (jsonMessageMatch) {
      safeMessage = `Error: ${jsonMessageMatch[1]}`;
    } else if (plainMessageMatch) {
      safeMessage = `Error: ${plainMessageMatch[1]}`;
    } else {
      safeMessage = safeMessage.split('\n')[0].substring(0, 100);
      if (!safeMessage.toLowerCase().includes('error')) {
        safeMessage = `Error: ${safeMessage}`;
      }
    }
  }

  // 2. Strict length limit for UI stability
  const hasStructure = safeMessage.includes('```') || safeMessage.includes('`');
  const limit = hasStructure ? UI_CONFIG.STRUCTURED_CONTENT_LIMIT : UI_CONFIG.LOG_CHAR_LIMIT;

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

  // Ensure the type is one of the allowed Message types
  const typeMap: Record<string, 'user' | 'ai' | 'system' | 'welcome'> = {
    user: 'user',
    ai: 'ai',
    system: 'system',
    welcome: 'welcome',
  };

  const safeType = (ev.type && typeMap[ev.type]) || 'system';

  return {
    ...ev,
    id: ev.id || `sys-${Math.random().toString(36).substring(7)}`,
    type: safeType,
    content: sanitizedContent,
    timestamp: ev.timestamp || new Date(),
  };
}
