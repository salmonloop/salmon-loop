import { execa } from 'execa';
import { z } from 'zod';

import type {
  AuthorizationDecision,
  ResolvedExtensions,
  ResolvedMcpServer,
  ToolAuthorizationConfig,
  ToolAuthorizationRequest,
} from '../../core/facades/cli-authorization-non-interactive.js';
import { getLogger, McpClient } from '../../core/facades/cli-authorization-non-interactive.js';
import { getPlatformShellInvocation } from '../../core/utils/platform-shell.js';
import { text } from '../locales/index.js';

const DecisionSchema = z
  .object({
    outcome: z.enum(['allow', 'allow_once', 'allow_session', 'deny']),
    reason: z.string().optional(),
    ttlMs: z.number().int().positive().optional(),
    persist: z.enum(['repo', 'user']).optional(),
  })
  .strict();

function normalizeDecisionSource(decision: AuthorizationDecision): AuthorizationDecision {
  return { ...decision, source: 'hook' };
}

function deny(reason: string): AuthorizationDecision {
  return normalizeDecisionSource({ outcome: 'deny', reason });
}

function findMcpServer(
  extensions: ResolvedExtensions | undefined,
  name: string,
): ResolvedMcpServer | undefined {
  if (!extensions?.mcpServers) return undefined;
  return extensions.mcpServers.find((s) => s.enabled && s.name === name);
}

function toMcpClientConfig(server: ResolvedMcpServer) {
  if (server.transport === 'http') {
    return {
      name: server.name,
      url: server.url,
      headers: server.headers,
    } as const;
  }
  return {
    name: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
  } as const;
}

function extractDecisionPayloadFromMcpResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;

  const obj = result as any;
  if (obj.decision && typeof obj.decision === 'object') return obj.decision;
  if (typeof obj.outcome === 'string') return obj;

  const content = obj.content;
  if (!Array.isArray(content)) return result;

  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const candidate =
      (item as any).json ??
      (item as any).text ??
      (item as any).value ??
      (item as any).data ??
      undefined;
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    if (candidate && typeof candidate === 'object') return candidate;
  }

  return result;
}

export async function requestNonInteractiveAuthorizationDecision(params: {
  request: ToolAuthorizationRequest;
  config: ToolAuthorizationConfig;
  extensions?: ResolvedExtensions;
}): Promise<AuthorizationDecision | null> {
  const strategy = params.config.nonInteractive?.strategy ?? 'deny';
  if (strategy === 'deny') return null;

  if (strategy === 'command') {
    const cmd = params.config.nonInteractive?.command?.cmd;
    if (!cmd) {
      getLogger().warn(
        'Non-interactive authorization strategy is "command" but no command is set.',
      );
      return deny(text.cli.toolAuthorizationNonInteractiveMisconfigured('command'));
    }

    const timeoutMs = params.config.nonInteractive?.command?.timeoutMs ?? 10_000;
    try {
      const invocation = getPlatformShellInvocation(cmd);
      const res = await execa(invocation.file, invocation.args, {
        input: JSON.stringify({ request: params.request }),
        shell: false,
        timeout: timeoutMs,
        reject: false,
      });

      if (typeof res.exitCode === 'number' && res.exitCode !== 0) {
        return deny(text.cli.toolAuthorizationNonInteractiveFailed('command_failed'));
      }

      const stdout = String(res.stdout ?? '').trim();
      if (!stdout) {
        getLogger().warn('Non-interactive authorization command returned empty stdout.');
        return deny(text.cli.toolAuthorizationNonInteractiveFailed('empty_response'));
      }

      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        return deny(text.cli.toolAuthorizationNonInteractiveFailed('invalid_json'));
      }

      const parsed = DecisionSchema.safeParse(json);
      if (!parsed.success) {
        getLogger().warn('Non-interactive authorization command returned invalid decision JSON.');
        return deny(text.cli.toolAuthorizationNonInteractiveFailed('invalid_decision'));
      }

      return normalizeDecisionSource(parsed.data as AuthorizationDecision);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      getLogger().warn(`Non-interactive authorization command failed: ${msg}`);
      return deny(text.cli.toolAuthorizationNonInteractiveFailed('command_failed'));
    }
  }

  if (strategy === 'mcp') {
    const serverName = params.config.nonInteractive?.mcp?.server;
    const toolName = params.config.nonInteractive?.mcp?.tool;
    if (!serverName || !toolName) {
      getLogger().warn(
        'Non-interactive authorization strategy is "mcp" but server/tool is missing.',
      );
      return deny(text.cli.toolAuthorizationNonInteractiveMisconfigured('mcp'));
    }

    const server = findMcpServer(params.extensions, serverName);
    if (!server) {
      getLogger().warn(
        `Non-interactive authorization MCP server not found or disabled: ${serverName}`,
      );
      return deny(text.cli.toolAuthorizationNonInteractiveFailed('mcp_server_not_found'));
    }

    const timeoutMs = params.config.nonInteractive?.mcp?.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const client = new McpClient(toMcpClientConfig(server) as any);
    try {
      await client.start();
      const result = await Promise.race([
        client.callTool(toolName, { request: params.request }),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('timeout')), {
            once: true,
          });
        }),
      ]);

      const payload = extractDecisionPayloadFromMcpResult(result);
      const parsed = DecisionSchema.safeParse(payload);
      if (!parsed.success) {
        getLogger().warn(
          'Non-interactive authorization MCP tool returned invalid decision payload.',
        );
        return deny(text.cli.toolAuthorizationNonInteractiveFailed('invalid_decision'));
      }

      return normalizeDecisionSource(parsed.data as AuthorizationDecision);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      getLogger().warn(`Non-interactive authorization MCP tool failed: ${msg}`);
      return deny(text.cli.toolAuthorizationNonInteractiveFailed('mcp_failed'));
    } finally {
      clearTimeout(timeout);
      await client.stop();
    }
  }

  const unknown = String(params.config.nonInteractive?.strategy ?? '');
  getLogger().warn(text.cli.toolAuthorizationNonInteractiveUnsupported(unknown));
  return deny(text.cli.toolAuthorizationNonInteractiveUnsupported(unknown));
}
