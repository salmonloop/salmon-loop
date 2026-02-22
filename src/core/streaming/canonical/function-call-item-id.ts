const PREFIX = 'function_call:';

export function formatCanonicalFunctionCallItemId(callId: string): string {
  return `${PREFIX}${callId}`;
}

export function parseCanonicalFunctionCallItemId(itemId?: string): string | null {
  if (!itemId) return null;
  if (!itemId.startsWith(PREFIX)) return null;
  const callId = itemId.slice(PREFIX.length);
  return callId ? callId : null;
}
