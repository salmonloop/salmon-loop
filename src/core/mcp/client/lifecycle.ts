import type { McpConnectionManager } from './connection-manager.js';

export async function withMcpConnections<T>(
  manager: McpConnectionManager,
  fn: () => Promise<T>,
): Promise<T> {
  await manager.startAll();
  try {
    return await fn();
  } finally {
    await manager.stopAll();
  }
}

export async function stopMcpConnections(manager: McpConnectionManager): Promise<void> {
  await manager.stopAll();
}
