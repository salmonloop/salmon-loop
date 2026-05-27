import type { ToolKind } from '@agentclientprotocol/sdk';

/**
 * Maps a tool name and optional metadata to an ACP ToolKind.
 *
 * Priority: explicit intent > side-effect inference > name heuristics.
 *
 * Covers all 10 protocol-defined kinds:
 * read | edit | delete | move | search | execute | think | fetch | switch_mode | other
 */
export function mapToolKind(
  toolName: string,
  options?: { intent?: string; sideEffects?: string[] },
): ToolKind {
  const intent = options?.intent;
  if (intent) {
    switch (intent.toUpperCase()) {
      case 'READ':
      case 'LIST':
        return 'read';
      case 'SEARCH':
        return 'search';
      case 'WRITE':
        return 'edit';
      case 'INFRA':
        return 'execute';
      case 'AGENT':
        return 'think';
    }
  }

  const sideEffects = options?.sideEffects;
  if (sideEffects && sideEffects.length > 0) {
    if (sideEffects.every((e) => e === 'fs_read')) return 'read';
    if (sideEffects.includes('fs_write')) return 'edit';
    if (sideEffects.includes('fs_delete')) return 'delete';
    if (sideEffects.includes('process')) return 'execute';
  }

  const name = toolName.toLowerCase();
  if (
    name.includes('read') ||
    name.includes('get') ||
    name.includes('view') ||
    name.includes('ls') ||
    name.includes('list')
  )
    return 'read';
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'edit';
  if (name.includes('delete') || name.includes('remove') || name.includes('rm')) return 'delete';
  if (name.includes('move') || name.includes('rename') || name.includes('mv')) return 'move';
  if (name.includes('grep') || name.includes('search') || name.includes('find')) return 'search';
  if (name.includes('run') || name.includes('exec') || name.includes('spawn')) return 'execute';
  if (name.includes('plan') || name.includes('think') || name.includes('reason')) return 'think';
  if (name.includes('fetch') || name.includes('curl') || name.includes('http')) return 'fetch';
  if (name.includes('mode') || name.includes('switch')) return 'switch_mode';
  return 'other';
}
