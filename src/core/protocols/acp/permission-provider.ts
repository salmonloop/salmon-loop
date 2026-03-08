import type {
  AgentSideConnection,
  PermissionOption,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk';
import type { ClientCapabilities } from '@agentclientprotocol/sdk';

import type {
  ToolAuthorizationProvider,
  ToolAuthorizationRequest,
} from '../../tools/authorization/types.js';

function toToolKind(request: ToolAuthorizationRequest): ToolKind {
  const name = request.toolName.toLowerCase();
  if (name.includes('read') || request.sideEffects.every((e) => e === 'fs_read')) return 'read';
  if (name.includes('delete') || request.sideEffects.includes('fs_delete' as any)) return 'delete';
  if (name.includes('write') || request.sideEffects.includes('fs_write')) return 'edit';
  return 'execute';
}

function buildPermissionOptions(): PermissionOption[] {
  return [
    { kind: 'allow_once', name: 'Allow once', optionId: 'allow_once' },
    { kind: 'allow_always', name: 'Allow for session', optionId: 'allow_always' },
    { kind: 'reject_once', name: 'Reject once', optionId: 'reject_once' },
    { kind: 'reject_always', name: 'Reject for session', optionId: 'reject_always' },
  ];
}

function toToolCallUpdate(request: ToolAuthorizationRequest): ToolCallUpdate {
  const looksAbsolute =
    typeof request.argsSummary === 'string' &&
    (request.argsSummary.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(request.argsSummary) ||
      request.argsSummary.startsWith('\\\\'));
  return {
    toolCallId: request.id,
    title: request.toolName,
    kind: toToolKind(request),
    status: 'pending',
    rawInput: {
      toolName: request.toolName,
      argsSummary: request.argsSummary,
      riskLevel: request.riskLevel,
      sideEffects: request.sideEffects,
    },
    locations: looksAbsolute ? [{ path: request.argsSummary! }] : undefined,
  };
}

export function createAcpToolAuthorizationProvider(params: {
  conn: AgentSideConnection;
  sessionId: string;
  clientCapabilities: ClientCapabilities;
  getPermissionPolicy?: () => 'ask' | 'deny_all' | 'allow_all';
  enforceClientCapabilities?: boolean;
}): ToolAuthorizationProvider {
  return {
    async requestAuthorization(request: ToolAuthorizationRequest) {
      const enforceClientCapabilities = params.enforceClientCapabilities ?? true;
      if (enforceClientCapabilities) {
        if (
          request.sideEffects.includes('fs_read') &&
          !params.clientCapabilities.fs?.readTextFile
        ) {
          return {
            outcome: 'deny',
            reason: 'client_missing_capability: fs.readTextFile',
            source: 'auto',
          };
        }
        if (
          request.sideEffects.includes('fs_write') &&
          !params.clientCapabilities.fs?.writeTextFile
        ) {
          return {
            outcome: 'deny',
            reason: 'client_missing_capability: fs.writeTextFile',
            source: 'auto',
          };
        }
        if (request.sideEffects.includes('process') && !params.clientCapabilities.terminal) {
          return { outcome: 'deny', reason: 'client_missing_capability: terminal', source: 'auto' };
        }
      }
      const permissionPolicy = params.getPermissionPolicy?.() ?? 'ask';
      if (permissionPolicy === 'allow_all') {
        return { outcome: 'allow_session', source: 'auto', reason: 'session_mode:yolo' };
      }
      const hasSideEffects = request.sideEffects.some((effect) => effect !== 'fs_read');
      if (permissionPolicy === 'deny_all' && hasSideEffects) {
        return { outcome: 'deny', reason: 'session_config:deny_all', source: 'auto' };
      }

      const toolCall = toToolCallUpdate(request);
      const response = await params.conn.requestPermission({
        sessionId: params.sessionId,
        toolCall,
        options: buildPermissionOptions(),
      });

      if (response.outcome.outcome === 'cancelled') {
        return { outcome: 'deny', reason: 'cancelled', source: 'user' };
      }

      switch (response.outcome.optionId) {
        case 'allow_once':
          return { outcome: 'allow_once', source: 'user' };
        case 'allow_always':
          return { outcome: 'allow_session', source: 'user' };
        case 'reject_once':
        case 'reject_always':
          return { outcome: 'deny', reason: 'rejected', source: 'user' };
        default:
          return {
            outcome: 'deny',
            reason: `unknown option: ${response.outcome.optionId}`,
            source: 'user',
          };
      }
    },
  };
}
