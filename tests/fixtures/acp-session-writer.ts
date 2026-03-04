import { createAcpFormalAgent } from '../../src/core/protocols/acp/formal-agent.js';

function createFacade() {
  return {
    createTask: async () => {
      throw new Error('not used');
    },
    getTask: async () => null,
    cancelTask: async () => null,
    resumeTask: async () => null,
    retryTask: async () => null,
    reopenTask: async () => null,
    listTasks: async () => ({ items: [] }),
    submitInput: async () => null,
    getArtifact: async () => null,
  };
}

async function main(): Promise<void> {
  const persistencePath = process.argv[2];
  const cwd = process.argv[3] ?? '/repo';
  if (!persistencePath) {
    throw new Error('Usage: bun tests/fixtures/acp-session-writer.ts <persistencePath> [cwd]');
  }

  const agent = createAcpFormalAgent({
    conn: {
      sessionUpdate: async () => {},
    } as any,
    agentInfo: { name: 'salmon-loop', version: '0.2.0' },
    facade: createFacade(),
    sessionPersistencePath: persistencePath,
  });

  await agent.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  });
  const session = await agent.newSession({ cwd, mcpServers: [] });
  process.stdout.write(`${session.sessionId}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
