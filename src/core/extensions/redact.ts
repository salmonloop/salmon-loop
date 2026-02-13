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

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    const shouldRedact = normalized === 'authorization' || SECRET_KEY_PATTERN.test(key);
    output[key] = shouldRedact ? REDACTED : value;
  }
  return output;
}

function redactServer(server: ResolvedMcpServer): ResolvedMcpServer {
  if (server.transport === 'http') {
    return {
      ...server,
      headers: redactHeaders(server.headers || {}),
    };
  }
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
