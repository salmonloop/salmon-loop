import { ResolvedExtensions, ResolvedMcpServer } from './types.js';

const SECRET_KEY_PATTERN = /(key|token|secret|password)/i;
const REDACTED = '<redacted>';

function redactEnv(env: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return output;
}

function redactServer(server: ResolvedMcpServer): ResolvedMcpServer {
  return {
    ...server,
    env: redactEnv(server.env || {}),
  };
}

export function redactExtensions(extensions: ResolvedExtensions): ResolvedExtensions {
  return {
    ...extensions,
    mcpServers: extensions.mcpServers.map(redactServer),
  };
}
