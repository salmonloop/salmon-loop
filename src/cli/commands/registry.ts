import * as crypto from 'crypto';

import { logger } from '../../core/logger.js';
import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';
import type { SideEffect } from '../../core/tools/types.js';
import { EXECUTION_PHASES } from '../../core/types.js';
import {
  clearAllowlist,
  clearAllowlistCache,
  listAllowlist,
  persistAllowlistDecision,
  removeAllowlistRule,
} from '../authorization/allowlist.js';
import { text } from '../locales/index.js';

import { Command, CommandContext, CommandResult } from './types.js';

/**
 * Parses input to provide a structured context for suggestions.
 */
function parseSuggestionContext(input: string) {
  const trimmed = input.trimStart();
  const parts = trimmed.split(/\s+/);

  // argIndex always points to the current argument slot being filled
  // e.g., "/session " splits to ["/session", ""], argIndex is 1.
  const argIndex = parts.length - 1;
  const currentPrefix = parts[argIndex] || '';
  const isSpaceTrailing = input.endsWith(' ');

  return { argIndex, currentPrefix, isSpaceTrailing };
}

function parseToken(tokens: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  const token = tokens.find((t) => t.startsWith(prefix));
  if (!token) return undefined;
  return token.slice(prefix.length);
}

function parseTokenList(tokens: string[], key: string): SideEffect[] | undefined {
  const raw = parseToken(tokens, key);
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? (values as SideEffect[]) : undefined;
}

function hashArgsInput(raw: string): string {
  let payload = raw;
  try {
    payload = JSON.stringify(JSON.parse(raw));
  } catch {
    payload = raw;
  }
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export const commands: Command[] = [
  {
    name: '/exit',
    description: text.cli.commandExit,
    execute: () => process.exit(0),
  },
  {
    name: '/quit',
    description: text.cli.commandExit,
    execute: () => process.exit(0),
  },
  {
    name: '/status',
    description: text.cli.commandStatus,
    execute: ({ emit, sessionManager }) => {
      const session = sessionManager.getCurrent();
      const statusMsg = [
        `Session: ${session.meta.name}`,
        `ID: ${session.meta.id.slice(0, 8)}`,
        `Iterations: ${session.meta.totalIterations} (${session.meta.successfulIterations} ok)`,
        `Messages: ${session.messages.length}`,
      ].join(' | ');
      emit({ type: 'log', level: 'info', message: statusMsg, timestamp: new Date() });
    },
  },
  {
    name: '/queue',
    description: text.cli.commandQueue,
    getSuggestions: ({ input }) => {
      const { argIndex, currentPrefix } = parseSuggestionContext(input);

      if (argIndex === 1) {
        const subCommands = ['status', 'pause', 'resume', 'retry', 'clear'];
        const search = currentPrefix.toLowerCase();
        return subCommands
          .filter((s) => s.startsWith(search))
          .map((s) => ({ name: s, description: text.cli.queueSubcommandHint(s) }));
      }

      return [];
    },
    execute: ({ emit, input, queue }) => {
      if (!queue) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.queueUnavailable,
          timestamp: new Date(),
        });
        return;
      }

      const args = input.trim().split(/\s+/).slice(1);
      const subCommand = (args[0] || 'status').toLowerCase();
      const status = queue.status();

      if (subCommand === 'status') {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueStatus(
            status.pendingCount,
            status.isProcessing,
            status.isPaused,
            status.hasInterrupted,
          ),
          timestamp: new Date(),
        });
        if (status.hasInterrupted) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.queueInterruptedHint,
            timestamp: new Date(),
          });
        }
        return;
      }

      if (subCommand === 'pause') {
        if (status.isPaused) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.queueAlreadyPaused,
            timestamp: new Date(),
          });
          logger.audit('QUEUE_PAUSE', { status: 'already_paused' }, 'cli');
          return;
        }
        queue.pause();
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queuePaused,
          timestamp: new Date(),
        });
        logger.audit('QUEUE_PAUSE', { status: 'paused' }, 'cli');
        return;
      }

      if (subCommand === 'resume') {
        if (!status.isPaused) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.queueNotPaused,
            timestamp: new Date(),
          });
          logger.audit('QUEUE_RESUME', { status: 'not_paused' }, 'cli');
          return;
        }
        queue.resume();
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueResumed,
          timestamp: new Date(),
        });
        logger.audit('QUEUE_RESUME', { status: 'resumed' }, 'cli');
        return;
      }

      if (subCommand === 'retry') {
        const retried = queue.retry();
        if (!retried) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.queueRetryMissing,
            timestamp: new Date(),
          });
          return;
        }
        queue.resume();
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueRetryQueued,
          timestamp: new Date(),
        });
        return;
      }

      if (subCommand === 'clear') {
        const cleared = queue.clear();
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.queueClearedCount(cleared),
          timestamp: new Date(),
        });
        logger.audit('QUEUE_CLEAR', { cleared }, 'cli');
        return;
      }

      emit({
        type: 'log',
        level: 'error',
        message: text.cli.queueUsage,
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/auth',
    description: text.cli.commandAuth,
    getSuggestions: ({ input }) => {
      const { argIndex, currentPrefix } = parseSuggestionContext(input);
      const parts = input.trimStart().split(/\s+/);
      const sub = parts[1]?.toLowerCase();

      if (argIndex === 1) {
        const subCommands = ['list', 'add', 'remove', 'clear', 'hash', 'reload'];
        const search = currentPrefix.toLowerCase();
        return subCommands
          .filter((s) => s.startsWith(search))
          .map((s) => ({ name: s, description: text.cli.authSubcommandHint(s) }));
      }

      if (argIndex === 2 && ['list', 'add', 'remove', 'clear'].includes(sub)) {
        const scopes = ['repo', 'user'];
        const search = currentPrefix.toLowerCase();
        return scopes
          .filter((s) => s.startsWith(search))
          .map((s) => ({ name: s, description: text.cli.authScopeHint(s) }));
      }

      if (argIndex === 3 && ['add', 'remove'].includes(sub)) {
        const phases = EXECUTION_PHASES.map((p) => p.toLowerCase());
        const search = currentPrefix.toLowerCase();
        return phases
          .filter((p) => p.startsWith(search))
          .map((p) => ({ name: p, description: text.cli.authPhaseHint(p) }));
      }

      return [];
    },
    execute: async ({ emit, input, sessionManager, toolAuthorization }) => {
      const repoRoot = sessionManager.getCurrent().meta.repoPath;
      const config = toolAuthorization;
      if (!config) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.authConfigMissing,
          timestamp: new Date(),
        });
        return;
      }

      const args = input.trim().split(/\s+/).slice(1);
      const subCommand = (args[0] || 'list').toLowerCase();

      const scopeArg = args[1]?.toLowerCase();
      const scope = scopeArg === 'user' ? 'user' : 'repo';

      if (subCommand === 'reload') {
        await clearAllowlistCache({ config, repoRoot });
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.authCacheCleared,
          timestamp: new Date(),
        });
        return;
      }

      if (subCommand === 'hash') {
        const raw = args.slice(1).join(' ').trim();
        if (!raw) {
          emit({
            type: 'log',
            level: 'error',
            message: text.cli.authHashUsage,
            timestamp: new Date(),
          });
          return;
        }
        const hash = hashArgsInput(raw);
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.authHashResult(hash),
          timestamp: new Date(),
        });
        return;
      }

      if (subCommand === 'list') {
        const allowlist = await listAllowlist({ config, repoRoot, scope });
        const entries = Object.entries(allowlist.tools);
        if (entries.length === 0) {
          emit({
            type: 'log',
            level: 'info',
            message: text.cli.authListEmpty(scope),
            timestamp: new Date(),
          });
          return;
        }
        const lines = entries.flatMap(([tool, entry]) => {
          const rules = entry.rules || [];
          if (rules.length === 0) {
            return [text.cli.authListEntry(tool, entry.mode || 'allow', undefined, undefined)];
          }
          return rules.map((rule) =>
            text.cli.authListEntry(
              tool,
              rule.mode,
              rule.phase?.toLowerCase(),
              rule.argsHash,
              rule.sideEffects,
            ),
          );
        });
        emit({
          type: 'log',
          level: 'info',
          message: lines.join('\n'),
          timestamp: new Date(),
        });
        return;
      }

      if (subCommand === 'clear') {
        await clearAllowlist({ config, repoRoot, scope });
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.authCleared(scope),
          timestamp: new Date(),
        });
        return;
      }

      if (subCommand === 'add') {
        const toolName = args[2];
        if (!toolName) {
          emit({
            type: 'log',
            level: 'error',
            message: text.cli.authAddUsage,
            timestamp: new Date(),
          });
          return;
        }
        const phase = args[3]?.toUpperCase();
        if (phase && !EXECUTION_PHASES.includes(phase as any)) {
          emit({
            type: 'log',
            level: 'error',
            message: text.cli.authInvalidPhase(phase),
            timestamp: new Date(),
          });
          return;
        }
        const tokens = args.slice(4);
        const sideEffects = parseTokenList(tokens, 'effects');
        const argsHash = parseToken(tokens, 'args');
        const mode = tokens.includes('deny') ? 'deny' : 'allow';

        await persistAllowlistDecision({
          config,
          repoRoot,
          toolName,
          phase: (phase || 'CONTEXT') as any,
          scope,
          mode,
          sideEffects,
          argsHash,
        });

        emit({
          type: 'log',
          level: 'info',
          message: text.cli.authAdded(toolName, scope, mode),
          timestamp: new Date(),
        });
        return;
      }

      if (subCommand === 'remove') {
        const toolName = args[2];
        if (!toolName) {
          emit({
            type: 'log',
            level: 'error',
            message: text.cli.authRemoveUsage,
            timestamp: new Date(),
          });
          return;
        }
        const phase = args[3]?.toUpperCase();
        if (phase && !EXECUTION_PHASES.includes(phase as any)) {
          emit({
            type: 'log',
            level: 'error',
            message: text.cli.authInvalidPhase(phase),
            timestamp: new Date(),
          });
          return;
        }
        const tokens = args.slice(4);
        const sideEffects = parseTokenList(tokens, 'effects');
        const argsHash = parseToken(tokens, 'args');

        const removed = await removeAllowlistRule({
          config,
          repoRoot,
          scope,
          toolName,
          phase: phase as any,
          sideEffects,
          argsHash,
        });

        emit({
          type: 'log',
          level: removed ? 'info' : 'warn',
          message: removed
            ? text.cli.authRemoved(toolName, scope)
            : text.cli.authRemoveMissing(toolName, scope),
          timestamp: new Date(),
        });
        return;
      }

      emit({
        type: 'log',
        level: 'error',
        message: text.cli.authUsage,
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/new',
    description: text.cli.commandClear,
    execute: async ({ emit, sessionManager, dispatch }) => {
      const session = await sessionManager.create();
      dispatch({ type: 'RESET_MESSAGES' });
      emit({ type: 'checkpoint.created', worktreePath: '', baseRef: '', timestamp: new Date() });
      emit({
        type: 'log',
        level: 'info',
        message: `🚀 ${text.cli.chatNewSession(session.meta.id.slice(0, 8))}`,
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/help',
    description: 'Show available commands',
    execute: ({ emit }) => {
      const helpMsg = commands.map((c) => `${c.name.padEnd(10)} - ${c.description}`).join('\n');
      emit({
        type: 'log',
        level: 'info',
        message: `Available Commands:\n${helpMsg}`,
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/session',
    description: text.cli.commandSessions,
    getSuggestions: async ({ sessionManager, input }) => {
      const { argIndex, currentPrefix } = parseSuggestionContext(input);

      // Level 1: Suggest sessions
      if (argIndex === 1) {
        const sessions = await sessionManager.listSessions();
        const search = currentPrefix.toLowerCase();
        return sessions
          .filter(
            (s) => s.id.toLowerCase().startsWith(search) || s.name.toLowerCase().includes(search),
          )
          .map((s) => ({
            name: s.id.slice(0, 8),
            description: `${s.name} (${new Date(s.updatedAt).toLocaleDateString()})`,
          }));
      }

      return [];
    },
    execute: async ({ emit, sessionManager, input, dispatch }) => {
      const args = input.trim().split(/\s+/).slice(1);
      if (args.length > 0) {
        const sessionId = args[0];
        try {
          await sessionManager.resumeSession(sessionId);
          dispatch({ type: 'RESET_MESSAGES' });
          emit({
            type: 'log',
            level: 'info',
            message: `Switched to session: ${sessionId}`,
            timestamp: new Date(),
          });
        } catch (error: any) {
          emit({
            type: 'log',
            level: 'error',
            message: `Failed to switch session: ${error.message}`,
          });
        }
        return;
      }

      const sessions = await sessionManager.listSessions();
      if (sessions.length === 0) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.noSessionsFound,
          timestamp: new Date(),
        });
        return;
      }
      emit({
        type: 'log',
        level: 'info',
        message: 'Type "/session " (with a space) to select a session from the interactive list.',
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/snapshot',
    description: 'Manage repository snapshots (list, create, delete, restore)',
    getSuggestions: async ({ sessionManager, input }) => {
      const { argIndex, currentPrefix } = parseSuggestionContext(input);
      const parts = input.trimStart().split(/\s+/);

      // Level 1: Sub-command suggestions
      if (argIndex === 1) {
        const subCommands = ['list', 'create', 'delete', 'restore'];
        const search = currentPrefix.toLowerCase();
        return subCommands
          .filter((s) => s.startsWith(search))
          .map((s) => ({ name: s, description: `Snapshot ${s} command` }));
      }

      // Level 2: Data suggestions (hashes)
      if (argIndex === 2) {
        const subAction = parts[1]?.toLowerCase();
        if (['restore', 'delete', 'list'].includes(subAction)) {
          const manager = new CheckpointManager();
          const repoPath = sessionManager.getCurrent().meta.repoPath;
          const snapshots = await manager.listSnapshots(repoPath);
          const search = currentPrefix.toLowerCase();
          return snapshots
            .filter((s) => s.hash.toLowerCase().startsWith(search))
            .map((s) => ({
              name: s.hash.slice(0, 7),
              description: s.message,
            }));
        }
      }

      return [];
    },
    execute: async ({ emit, sessionManager, input }): Promise<CommandResult | void> => {
      const args = input.trim().split(/\s+/).slice(1);
      const subCommand = args[0]?.toLowerCase();
      const repoPath = sessionManager.getCurrent().meta.repoPath;
      const manager = new CheckpointManager();

      if (subCommand === 'list') {
        const hash = args[1];
        if (!hash) {
          emit({
            type: 'log',
            level: 'info',
            message: 'Select a snapshot from the suggestions below to view its details.',
            timestamp: new Date(),
          });
          return;
        }

        const details = await manager.getSnapshotDetails(repoPath, hash);
        const stagedCount = details.stagedFiles.length;
        const unstagedCount = details.unstagedFiles.length;

        emit({
          type: 'log',
          level: 'info',
          message: `Snapshot [${hash.slice(0, 7)}] Details:\n- Staged: ${stagedCount} files\n- Unstaged: ${unstagedCount} files\n\nUse "/snapshot restore ${hash.slice(0, 7)}" to revert your workspace.`,
          timestamp: new Date(),
        });
      } else if (subCommand === 'create') {
        const message = args.slice(1).join(' ') || 'Manual snapshot';
        const result = await manager.createSafeSnapshot(repoPath, [], message);
        emit({
          type: 'log',
          level: 'info',
          message: `Snapshot created: ${result.commitHash.slice(0, 7)}`,
          timestamp: new Date(),
        });
      } else if (subCommand === 'delete') {
        const hash = args[1];
        if (!hash) {
          emit({
            type: 'log',
            level: 'error',
            message: 'Usage: /snapshot delete <hash>',
            timestamp: new Date(),
          });
          return;
        }
        await manager.deleteSnapshot(repoPath, hash);
        emit({
          type: 'log',
          level: 'info',
          message: `Snapshot ${hash} deleted.`,
          timestamp: new Date(),
        });
      } else if (subCommand === 'restore') {
        const hash = args[1];
        if (!hash) {
          emit({
            type: 'log',
            level: 'error',
            message: 'Usage: /snapshot restore <hash>',
            timestamp: new Date(),
          });
          return;
        }
        // Intercept for high-risk operation
        return {
          action: 'NEED_CONFIRMATION',
          message: `Restore will overwrite your current workspace.`,
          data: {
            command: '/snapshot',
            args: ['restore', hash],
            challenge: hash.slice(0, 6),
          },
        };
      } else {
        emit({
          type: 'log',
          level: 'error',
          message: 'Unknown subcommand. Use list, create, delete, or restore.',
          timestamp: new Date(),
        });
      }
    },
  },
];

export async function getSuggestions(
  input: string,
  context: CommandContext,
): Promise<{ name: string; description: string }[]> {
  const { argIndex, currentPrefix } = parseSuggestionContext(input);

  if (!input.trimStart().startsWith('/')) return [];

  const commandName = input.trimStart().split(/\s+/)[0].toLowerCase();
  const exactMatch = commands.find((c) => c.name.toLowerCase() === commandName);

  // If we have an exact command match and we are in the argument area
  if (exactMatch && argIndex > 0) {
    return exactMatch.getSuggestions ? await exactMatch.getSuggestions(context) : [];
  }

  // Otherwise, suggest base commands
  const search = currentPrefix.toLowerCase();
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(search))
    .map((c) => ({ name: c.name, description: c.description }));
}

export function findCommand(input: string): Command | undefined {
  const firstWord = input.trim().split(/\s+/)[0].toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === firstWord);
}
