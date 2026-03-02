import type { AgentSideConnection } from '@agentclientprotocol/sdk';

import type { FileSystem } from '../../types/index.js';

function isResourceNotFoundError(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false;
  const code = (error as { code?: unknown }).code;
  return code === -32002;
}

export function createAcpFileSystem(params: {
  conn: AgentSideConnection;
  sessionId: string;
}): FileSystem {
  return {
    async readFile(path: string, _encoding?: string): Promise<string> {
      const result = await params.conn.readTextFile({
        sessionId: params.sessionId,
        path,
      });
      return result.content;
    },

    async writeFile(path: string, content: string): Promise<void> {
      await params.conn.writeTextFile({
        sessionId: params.sessionId,
        path,
        content,
      });
    },

    async exists(path: string): Promise<boolean> {
      try {
        await params.conn.readTextFile({ sessionId: params.sessionId, path });
        return true;
      } catch (error) {
        if (isResourceNotFoundError(error)) return false;
        throw error;
      }
    },

    async mkdir(): Promise<void> {
      // ACP formal FS methods are file-based; directory creation is host-dependent.
      // Hosts typically create parent directories as part of writeTextFile().
      return;
    },
  };
}
