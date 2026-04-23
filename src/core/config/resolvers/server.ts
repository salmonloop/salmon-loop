import type { ConfigFileV1, ResolvedConfig } from '../types.js';

export function resolveServerConfig(raw?: ConfigFileV1): ResolvedConfig['server'] {
  const serverRaw = raw?.server;
  if (!serverRaw) return undefined;
  const server: NonNullable<ResolvedConfig['server']> = {};
  if (serverRaw.a2a) {
    server.a2a = {
      host: serverRaw.a2a.host,
      port: serverRaw.a2a.port,
      tokens: serverRaw.a2a.tokens,
    };
  }
  if (serverRaw.acp) {
    server.acp = {
      sessionStore: {
        maxEntries: serverRaw.acp.sessionStore?.maxEntries,
        maxAgeMs: serverRaw.acp.sessionStore?.maxAgeMs,
        historyMaxEntries: serverRaw.acp.sessionStore?.historyMaxEntries,
        lockStaleMs: serverRaw.acp.sessionStore?.lockStaleMs,
        lockHeartbeatMs: serverRaw.acp.sessionStore?.lockHeartbeatMs,
      },
      checkpointManifest: {
        lockStaleMs: serverRaw.acp.checkpointManifest?.lockStaleMs,
        lockHeartbeatMs: serverRaw.acp.checkpointManifest?.lockHeartbeatMs,
      },
    };
  }
  return Object.keys(server).length > 0 ? server : undefined;
}
