import { createInterface } from 'readline/promises';

import type {
  AuthorizationDecision,
  PermissionMode,
  ResolvedExtensions,
  ToolAuthorizationConfig,
  ToolAuthorizationProvider,
  ToolAuthorizationRequest,
} from '../../core/facades/cli-authorization-provider.js';
import { logger } from '../../core/facades/cli-authorization-provider.js';
import { TOOL_AUTH_CONFIG } from '../config.js';
import { text } from '../locales/index.js';
import { getPendingAuthorization, requestAuthorization } from '../ui/authorization/bus.js';

import { loadAllowlistDecision, persistAllowlistDecision } from './allowlist.js';
import { requestNonInteractiveAuthorizationDecision } from './non-interactive.js';

const buildSummary = (request: ToolAuthorizationRequest) => {
  if (request.argsSummary && request.argsSummary.trim()) return request.argsSummary;
  return 'none';
};

const buildEffects = (request: ToolAuthorizationRequest) => {
  return request.sideEffects.length > 0 ? request.sideEffects.join(', ') : 'none';
};

const applySessionTtl = (
  decision: AuthorizationDecision,
  config: ToolAuthorizationConfig,
): AuthorizationDecision => {
  if (decision.outcome !== 'allow_session') return decision;
  return {
    ...decision,
    ttlMs: typeof decision.ttlMs === 'number' ? decision.ttlMs : config.sessionTtlMs,
  };
};

const shouldAutoAllow = (request: ToolAuthorizationRequest, config: ToolAuthorizationConfig) => {
  return Boolean(config.autoAllowRisk?.[request.riskLevel]);
};

const resolveConfig = (config?: ToolAuthorizationConfig): ToolAuthorizationConfig => {
  if (config) return config;
  return {
    sessionTtlMs: TOOL_AUTH_CONFIG.SESSION_TTL_MS,
    autoAllowRisk: TOOL_AUTH_CONFIG.AUTO_ALLOW_RISK,
    allowlist: {
      repoFile: '.salmonloop/config/authorization.json',
      userFile: '~/.salmonloop/config/authorization-user.json',
    },
  };
};

export function createUiAuthorizationProvider(options?: {
  emit?: (event: {
    type: 'log';
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
  }) => void;
  config?: ToolAuthorizationConfig;
  permissionMode?: PermissionMode;
}): ToolAuthorizationProvider {
  const pending = new Map<string, Promise<AuthorizationDecision>>();
  const resolved = new Map<string, AuthorizationDecision>();
  const queue: ToolAuthorizationRequest[] = [];
  const queued = new Map<string, ToolAuthorizationRequest>();
  const queuedResolvers = new Map<string, (decision: AuthorizationDecision) => void>();
  const queuedRejectors = new Map<string, (err: unknown) => void>();

  const finalize = async (
    request: ToolAuthorizationRequest,
    decision: AuthorizationDecision,
    config: ToolAuthorizationConfig,
  ) => {
    if (decision.outcome === 'deny') {
      options?.emit?.({
        type: 'log',
        level: 'warn',
        message: text.cli.toolAuthorizationDenied,
      });
      return {
        outcome: 'deny',
        reason: text.cli.toolAuthorizationDenied,
        source: 'user',
      } as AuthorizationDecision;
    }

    options?.emit?.({
      type: 'log',
      level: 'info',
      message: text.cli.toolAuthorizationApproved,
    });

    if (decision.persist) {
      await persistAllowlistDecision({
        config,
        repoRoot: request.repoRoot,
        toolName: request.toolName,
        phase: request.phase,
        scope: decision.persist,
        mode: 'allow',
        sideEffects: request.sideEffects,
        argsHash: request.argsHash,
      });
    }

    return applySessionTtl({ ...decision, source: decision.source ?? 'user' }, config);
  };

  return {
    async waitForAuthorization(requestId: string, signal?: AbortSignal) {
      const cached = resolved.get(requestId);
      if (cached) return cached;
      const existing = pending.get(requestId);
      if (!existing) return null;

      if (!signal) return existing;
      if (signal.aborted) return null;

      return Promise.race([
        existing,
        new Promise<AuthorizationDecision | null>((resolve) => {
          signal.addEventListener('abort', () => resolve(null), { once: true });
        }),
      ]);
    },

    async requestAuthorizationDeferred(request: ToolAuthorizationRequest) {
      const config = resolveConfig(options?.config);
      if (options?.permissionMode === 'yolo') {
        return {
          kind: 'decision',
          decision: applySessionTtl(
            {
              outcome: 'allow_session',
              source: 'auto',
              reason: 'permission_mode_yolo',
            },
            config,
          ),
        } as const;
      }

      const cached = resolved.get(request.id);
      if (cached) {
        return { kind: 'decision', decision: cached } as const;
      }

      const existing = pending.get(request.id);
      if (existing) {
        const challenge = request.id.slice(0, 6);
        return {
          kind: 'pending',
          challenge,
          message: text.cli.toolAuthorizationPrompt(
            request.toolName,
            request.riskLevel,
            buildEffects(request),
            buildSummary(request),
          ),
        } as const;
      }

      const allowlistDecision = await loadAllowlistDecision({
        config,
        repoRoot: request.repoRoot,
        toolName: request.toolName,
        phase: request.phase,
        sideEffects: request.sideEffects,
        argsHash: request.argsHash,
      });

      if (allowlistDecision === 'allow') {
        options?.emit?.({
          type: 'log',
          level: 'info',
          message: text.cli.toolAuthorizationAllowlisted(request.toolName),
        });
        return { kind: 'decision', decision: { outcome: 'allow', source: 'allowlist' } } as const;
      }

      if (allowlistDecision === 'deny') {
        options?.emit?.({
          type: 'log',
          level: 'warn',
          message: text.cli.toolAuthorizationDenylisted(request.toolName),
        });
        return {
          kind: 'decision',
          decision: {
            outcome: 'deny',
            reason: text.cli.toolAuthorizationDenylisted(request.toolName),
            source: 'allowlist',
          },
        } as const;
      }

      if (shouldAutoAllow(request, config)) {
        options?.emit?.({
          type: 'log',
          level: 'info',
          message: text.cli.toolAuthorizationAutoApproved(request.toolName, request.riskLevel),
        });
        return {
          kind: 'decision',
          decision: applySessionTtl({ outcome: 'allow_session', source: 'auto' }, config),
        } as const;
      }

      const summary = buildSummary(request);
      const effects = buildEffects(request);
      const message = text.cli.toolAuthorizationPrompt(
        request.toolName,
        request.riskLevel,
        effects,
        summary,
      );
      const challenge = request.id.slice(0, 6);

      const startNext = () => {
        if (getPendingAuthorization()) return;
        const next = queue.shift();
        if (!next) return;
        queued.delete(next.id);

        const resolver = queuedResolvers.get(next.id);
        const rejector = queuedRejectors.get(next.id);

        const p = requestAuthorization({
          id: next.id,
          message: text.cli.toolAuthorizationPrompt(
            next.toolName,
            next.riskLevel,
            buildEffects(next),
            buildSummary(next),
          ),
          challenge: next.id.slice(0, 6),
        }).then((decision) => finalize(next, decision, config));

        pending.set(next.id, p);
        p.then((decision) => {
          resolved.set(next.id, decision);
          pending.delete(next.id);
          queuedResolvers.delete(next.id);
          queuedRejectors.delete(next.id);
          resolver?.(decision);
          startNext();
        }).catch((err) => {
          pending.delete(next.id);
          queuedResolvers.delete(next.id);
          queuedRejectors.delete(next.id);
          rejector?.(err);
          startNext();
        });
      };

      if (!queued.has(request.id)) {
        queued.set(request.id, request);
        queue.push(request);
        const promise = new Promise<AuthorizationDecision>((resolve, reject) => {
          queuedResolvers.set(request.id, resolve);
          queuedRejectors.set(request.id, reject);
        });
        pending.set(request.id, promise);
      }

      startNext();
      return { kind: 'pending', challenge, message } as const;
    },

    async requestAuthorization(request: ToolAuthorizationRequest): Promise<AuthorizationDecision> {
      const config = resolveConfig(options?.config);
      if (options?.permissionMode === 'yolo') {
        return applySessionTtl(
          {
            outcome: 'allow_session',
            source: 'auto',
            reason: 'permission_mode_yolo',
          },
          config,
        );
      }
      const allowlistDecision = await loadAllowlistDecision({
        config,
        repoRoot: request.repoRoot,
        toolName: request.toolName,
        phase: request.phase,
        sideEffects: request.sideEffects,
        argsHash: request.argsHash,
      });

      if (allowlistDecision === 'allow') {
        options?.emit?.({
          type: 'log',
          level: 'info',
          message: text.cli.toolAuthorizationAllowlisted(request.toolName),
        });
        return { outcome: 'allow', source: 'allowlist' };
      }
      if (allowlistDecision === 'deny') {
        options?.emit?.({
          type: 'log',
          level: 'warn',
          message: text.cli.toolAuthorizationDenylisted(request.toolName),
        });
        return {
          outcome: 'deny',
          reason: text.cli.toolAuthorizationDenylisted(request.toolName),
          source: 'allowlist',
        };
      }

      if (shouldAutoAllow(request, config)) {
        options?.emit?.({
          type: 'log',
          level: 'info',
          message: text.cli.toolAuthorizationAutoApproved(request.toolName, request.riskLevel),
        });
        return applySessionTtl({ outcome: 'allow_session', source: 'auto' }, config);
      }

      const summary = buildSummary(request);
      const effects = buildEffects(request);
      const message = text.cli.toolAuthorizationPrompt(
        request.toolName,
        request.riskLevel,
        effects,
        summary,
      );
      const challenge = request.id.slice(0, 6);

      const decision = await requestAuthorization({
        id: request.id,
        message,
        challenge,
      });
      const finalized = await finalize(request, decision, config);
      resolved.set(request.id, finalized);
      return finalized;
    },
  };
}

export function createTerminalAuthorizationProvider(options?: {
  config?: ToolAuthorizationConfig;
  extensions?: ResolvedExtensions;
  forceNonInteractive?: boolean;
  permissionMode?: PermissionMode;
}): ToolAuthorizationProvider {
  const forceNonInteractive = Boolean(options?.forceNonInteractive);
  const deferredRequests = new Map<string, ToolAuthorizationRequest>();

  const shouldUseForcedDeferred = (
    request: ToolAuthorizationRequest,
    config: ToolAuthorizationConfig,
  ) => {
    if (!forceNonInteractive) return false;
    if (config.nonInteractive?.strategy === 'deny') return false;
    if (!request.id || !request.id.trim()) return false;
    return true;
  };

  const buildDeferredMessage = (request: ToolAuthorizationRequest) => {
    const summary = buildSummary(request);
    const effects = buildEffects(request);
    return text.cli.toolAuthorizationPrompt(request.toolName, request.riskLevel, effects, summary);
  };

  return {
    async waitForAuthorization(requestId: string) {
      const pending = deferredRequests.get(requestId);
      if (!pending) return null;
      deferredRequests.delete(requestId);
      return await this.requestAuthorization(pending);
    },

    async requestAuthorizationDeferred(request: ToolAuthorizationRequest) {
      const config = resolveConfig(options?.config);
      if (options?.permissionMode === 'yolo') {
        return {
          kind: 'decision',
          decision: applySessionTtl(
            {
              outcome: 'allow_session',
              source: 'auto',
              reason: 'permission_mode_yolo',
            },
            config,
          ),
        } as const;
      }
      if (shouldUseForcedDeferred(request, config)) {
        deferredRequests.set(request.id, request);
        return {
          kind: 'pending',
          challenge: request.id.slice(0, 6),
          message: buildDeferredMessage(request),
        } as const;
      }
      const decision = await this.requestAuthorization(request);
      return { kind: 'decision', decision } as const;
    },

    async requestAuthorization(request: ToolAuthorizationRequest): Promise<AuthorizationDecision> {
      const config = resolveConfig(options?.config);
      if (options?.permissionMode === 'yolo') {
        return applySessionTtl(
          {
            outcome: 'allow_session',
            source: 'auto',
            reason: 'permission_mode_yolo',
          },
          config,
        );
      }
      const allowlistDecision = await loadAllowlistDecision({
        config,
        repoRoot: request.repoRoot,
        toolName: request.toolName,
        phase: request.phase,
        sideEffects: request.sideEffects,
        argsHash: request.argsHash,
      });

      if (allowlistDecision === 'allow') {
        logger.info(text.cli.toolAuthorizationAllowlisted(request.toolName));
        return { outcome: 'allow', source: 'allowlist' };
      }
      if (allowlistDecision === 'deny') {
        logger.warn(text.cli.toolAuthorizationDenylisted(request.toolName));
        return {
          outcome: 'deny',
          reason: text.cli.toolAuthorizationDenylisted(request.toolName),
          source: 'allowlist',
        };
      }

      if (shouldAutoAllow(request, config)) {
        logger.info(text.cli.toolAuthorizationAutoApproved(request.toolName, request.riskLevel));
        return applySessionTtl({ outcome: 'allow_session', source: 'auto' }, config);
      }

      if (forceNonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
        const nonInteractive = await requestNonInteractiveAuthorizationDecision({
          request,
          config,
          extensions: options?.extensions,
        });
        if (nonInteractive) {
          if (nonInteractive.persist) {
            await persistAllowlistDecision({
              config,
              repoRoot: request.repoRoot,
              toolName: request.toolName,
              phase: request.phase,
              scope: nonInteractive.persist,
              mode: nonInteractive.outcome === 'deny' ? 'deny' : 'allow',
              sideEffects: request.sideEffects,
              argsHash: request.argsHash,
            });
          }
          return applySessionTtl(nonInteractive, config);
        }

        logger.warn(text.cli.toolAuthorizationMissingUi);
        return { outcome: 'deny', reason: text.cli.toolAuthorizationMissingUi };
      }

      const summary = buildSummary(request);
      const effects = buildEffects(request);
      const prompt = text.cli.toolAuthorizationPrompt(
        request.toolName,
        request.riskLevel,
        effects,
        summary,
      );

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(
          `${prompt}\n${text.cli.toolAuthorizationTerminalQuestion} `,
        );
        const normalized = answer.trim().toLowerCase();
        const allowSession = normalized.startsWith('a');
        const allowOnce = normalized.startsWith('y');
        const allowRepo = normalized.startsWith('s');
        const allowUser = normalized.startsWith('g');
        if (!allowSession && !allowOnce && !allowRepo && !allowUser) {
          logger.warn(text.cli.toolAuthorizationDenied);
          return { outcome: 'deny', reason: text.cli.toolAuthorizationDenied, source: 'user' };
        }
        logger.info(text.cli.toolAuthorizationApproved);
        const decision: AuthorizationDecision = allowRepo
          ? { outcome: 'allow', persist: 'repo', source: 'user' }
          : allowUser
            ? { outcome: 'allow', persist: 'user', source: 'user' }
            : { outcome: allowSession ? 'allow_session' : 'allow_once', source: 'user' };

        if (decision.persist) {
          await persistAllowlistDecision({
            config,
            repoRoot: request.repoRoot,
            toolName: request.toolName,
            phase: request.phase,
            scope: decision.persist,
            mode: 'allow',
            sideEffects: request.sideEffects,
            argsHash: request.argsHash,
          });
        }
        return applySessionTtl(decision, config);
      } finally {
        rl.close();
      }
    },
  };
}
