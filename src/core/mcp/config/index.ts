import type { ScopedEntry } from '../../extensions/merge.js';
import { expandHome, resolveRepoRelative, resolveUserRelative } from '../../extensions/paths.js';
import type { ResolvedMcpServerV2 } from '../types.js';

import type { RawMcpServerEntryV2 } from './schema-v2.js';

export {
  McpCapabilitiesV2Schema,
  McpConfigV2Schema,
  McpServerEntryV2Schema,
  type RawMcpConfigV2,
  type RawMcpServerEntryV2,
} from './schema-v2.js';

function resolvePathForScope(
  value: string | undefined,
  scope: 'user' | 'repo',
  repoRoot: string,
): string | undefined {
  if (!value) return undefined;
  const expanded = expandHome(value);
  return scope === 'repo' ? resolveRepoRelative(repoRoot, expanded) : resolveUserRelative(expanded);
}

function defaultEnabled(scope: 'user' | 'repo'): boolean {
  return scope === 'repo';
}

export function buildResolvedMcpServersV2(
  entries: ScopedEntry<RawMcpServerEntryV2>[],
  repoRoot: string,
): ResolvedMcpServerV2[] {
  return entries.map((entry) => {
    const source = entry.entry;
    const transport =
      source.transport.type === 'stdio'
        ? {
            ...source.transport,
            cwd: resolvePathForScope(source.transport.cwd, entry.scope, repoRoot),
          }
        : source.transport;

    return {
      name: entry.key,
      enabled: source.enabled ?? defaultEnabled(entry.scope),
      transport,
      auth: source.auth,
      trust: source.trust,
      capabilities: source.capabilities,
      scope: entry.scope,
    };
  });
}
