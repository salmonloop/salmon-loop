import { Readable, Writable } from 'node:stream';

import { AgentSideConnection, ndJsonStream, type Agent } from '@agentclientprotocol/sdk';

export function startAcpStdioServer(createAgent: (conn: AgentSideConnection) => Agent) {
  const output = Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>;
  const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);
  return new AgentSideConnection((conn) => createAgent(conn), stream);
}
