import { logger } from '../../core/observability/logger.js';
import { EXECUTION_PHASES } from '../../core/types/index.js';
import {
  clearAllowlist,
  clearAllowlistCache,
  listAllowlist,
  persistAllowlistDecision,
  removeAllowlistRule,
} from '../authorization/allowlist.js';
import { text } from '../locales/index.js';

import {
  clearKnownToolNames,
  getKnownToolNames,
  getKnownToolNamesSync,
  validateSideEffects,
} from './tool-names.js';
import type { Command } from './types.js';
import { hashArgsInput, parseSuggestionContext, parseToken, parseTokenList } from './utils.js';

export const allowlistCommand: Command = {
  name: '/allowlist',
  description: text.cli.commandAuth,
  order: 70,
  hidden: true,
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
      const repoRoot = process.cwd();
      const search = currentPrefix.toLowerCase();
      const tools = Array.from(getKnownToolNamesSync(repoRoot)).filter((name) =>
        name.toLowerCase().startsWith(search),
      );
      return tools.map((tool) => ({
        name: tool,
        description: text.cli.authToolNameHint,
      }));
    }

    if (argIndex === 4 && ['add', 'remove'].includes(sub)) {
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
      clearKnownToolNames(repoRoot);
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
      let knownTools: Set<string>;
      try {
        knownTools = await getKnownToolNames(repoRoot);
      } catch (error) {
        logger.warn(
          `Failed to load tool registry for validation: ${error instanceof Error ? error.message : String(error)}`,
        );
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.authToolRegistryUnavailable,
          timestamp: new Date(),
        });
        return;
      }
      if (!knownTools.has(toolName)) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.authInvalidToolName(toolName),
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
      const sideEffectsRaw = parseTokenList(tokens, 'effects');
      const sideEffectsValidation = validateSideEffects(sideEffectsRaw);
      if (sideEffectsValidation.invalid && sideEffectsValidation.invalid.length > 0) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.authInvalidSideEffects(sideEffectsValidation.invalid.join(', ')),
          timestamp: new Date(),
        });
        return;
      }
      const sideEffects = sideEffectsValidation.valid;
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
      const sideEffectsRaw = parseTokenList(tokens, 'effects');
      const sideEffectsValidation = validateSideEffects(sideEffectsRaw);
      if (sideEffectsValidation.invalid && sideEffectsValidation.invalid.length > 0) {
        emit({
          type: 'log',
          level: 'error',
          message: text.cli.authInvalidSideEffects(sideEffectsValidation.invalid.join(', ')),
          timestamp: new Date(),
        });
        return;
      }
      const sideEffects = sideEffectsValidation.valid;
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
};
