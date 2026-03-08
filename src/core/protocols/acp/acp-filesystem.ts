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
        // Use minimal limit to check existence without transferring full content
        await params.conn.readTextFile({ sessionId: params.sessionId, path, line: 1, limit: 1 });
        return true;
      } catch (error) {
        if (isResourceNotFoundError(error)) return false;
        throw error;
      }
    },

    async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
      // ACP formal FS methods are currently file-based; explicit directory creation
      // is usually handled implicitly by the host during writeTextFile().
      // This is a no-op to satisfy the interface while avoiding non-standard extensions.
      return;
    },
  };
}
