import {
  createSlashRegistry,
  createStandardToolstack,
  executeSkill,
  logIgnoredError,
  getLogger,
  RuntimeEnvironment,
  SkillLoader,
  SlashRouter,
  type SkillCatalogEntry,
  SlashCommandSpec,
  SlashDispatchDecision,
  SlashHandler,
  SlashHandlerProvider,
  type ToolAuthorizationProvider,
} from '../../core/facades/cli-slash-runtime.js';
import { formatHelpRows } from '../commands/help-format.js';
import { suggestSubcommands } from '../commands/subcommand-suggestions.js';
import type { Command, CommandContext } from '../commands/types.js';
import { text } from '../locales/index.js';

function isSafeSkillId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-_]*$/i.test(id);
}

/**
 * Build a SlashCommandSpec from a Tier 1 catalog entry (lightweight metadata).
 *
 * This supports the AgentSkills progressive disclosure pattern: only name and
 * description are needed at startup to populate the slash command registry.
 * Full skill content is loaded on demand via SkillLoader.activateSkill().
 *
 * @see https://agentskills.io/specification — Progressive disclosure
 */
function catalogEntryToSlashSpec(entry: SkillCatalogEntry): SlashCommandSpec | null {
  const id = String(entry.id || '').trim();
  if (!id || !isSafeSkillId(id)) return null;
  return {
    name: `/${id}`,
    description: entry.description || `Skill: ${id}`,
    order: 220,
  };
}

function commandToSlashSpec(cmd: Command): SlashCommandSpec {
  return {
    name: cmd.name,
    description: cmd.description,
    aliases: cmd.aliases,
    hidden: cmd.hidden,
    order: cmd.order,
  };
}

export interface CliSlashRuntime {
  router: SlashRouter;
  findCommand: (name: string) => Command | undefined;
  getSuggestions: (
    input: string,
    context: CommandContext,
  ) => Promise<Array<{ name: string; description: string; command?: Command }>>;
  dispatch: (
    input: string,
    context: CommandContext,
  ) => Promise<
    | { type: 'executed' }
    | { type: 'blocked'; reason: string }
    | { type: 'continue'; trimmedInput: string }
  >;
}

export interface CreateCliSlashRuntimeOptions {
  repoRoot: string;
  baseCommands: Command[];
  emit: (event: any) => void;
  authorizationProvider?: ToolAuthorizationProvider;
  skillDiscovery?: { paths?: string[] };
}

export async function createCliSlashRuntime(
  options: CreateCliSlashRuntimeOptions,
): Promise<CliSlashRuntime> {
  const skillLoader = new SkillLoader({
    repoRoot: options.repoRoot,
    extraPaths: options.skillDiscovery?.paths,
  });

  // Tier 1: Load lightweight catalog (name + description only, ~50-100 tokens per skill).
  // Full skill content is loaded on demand via activateSkill() (Tier 2).
  // @see https://agentskills.io/specification — Progressive disclosure
  const catalog = await skillLoader.loadCatalog();

  const skillSpecs = catalog
    .map(catalogEntryToSlashSpec)
    .filter((s): s is SlashCommandSpec => Boolean(s));
  const commandSpecs = options.baseCommands.map(commandToSlashSpec);

  // /help is best-effort and must reflect the effective registry (including skills).
  const helpSpec: SlashCommandSpec = {
    name: '/help',
    description: 'Show available commands',
    order: 80,
  };

  const registry = createSlashRegistry({
    commands: [helpSpec, ...commandSpecs, ...skillSpecs],
  });

  const commandTokenIndex = new Map<string, Command>();
  for (const cmd of options.baseCommands) {
    commandTokenIndex.set(cmd.name.toLowerCase(), cmd);
    for (const alias of cmd.aliases ?? []) {
      commandTokenIndex.set(alias.toLowerCase(), cmd);
    }
  }

  const skillBySlash = new Map<string, SkillCatalogEntry>();
  for (const entry of catalog) {
    const spec = catalogEntryToSlashSpec(entry);
    if (!spec) continue;
    skillBySlash.set(spec.name.toLowerCase(), entry);
  }

  const handlers: SlashHandlerProvider = {
    getHandler(commandName) {
      const normalized = commandName.toLowerCase();

      if (normalized === '/help') {
        const handler: SlashHandler = {
          execute: async (_req) => {
            const visible = registry.list().filter((c) => !c.hidden);
            const rows = formatHelpRows(visible);
            options.emit({
              type: 'log',
              level: 'info',
              message: text.cli.helpAvailableCommands(rows),
              timestamp: new Date(),
            });
            return { kind: 'consumed' };
          },
        };
        return handler;
      }

      const base = commandTokenIndex.get(normalized);
      if (base) {
        const baseGetSuggestions =
          base.getSuggestions ??
          (base.subcommands && base.subcommands.length > 0
            ? async (ctx: CommandContext) => suggestSubcommands(base, ctx)
            : undefined);
        return {
          execute: async (req) => {
            const meta = (req.meta ?? {}) as CommandContext;
            await base.execute({
              emit: meta.emit,
              sessionManager: meta.sessionManager,
              input: req.rawInput,
              dispatch: meta.dispatch,
              queue: meta.queue,
              toolAuthorization: meta.toolAuthorization,
              getLlmOutputPolicy: meta.getLlmOutputPolicy,
              setLlmOutputPolicy: meta.setLlmOutputPolicy,
            } as any);
            return { kind: 'consumed' };
          },
          getSuggestions: baseGetSuggestions
            ? async (_slashReq) => {
                const meta = (_slashReq.meta ?? {}) as CommandContext;
                const suggestions = await baseGetSuggestions({
                  emit: meta.emit,
                  sessionManager: meta.sessionManager,
                  input: _slashReq.rawInput,
                  dispatch: meta.dispatch,
                  queue: meta.queue,
                  toolAuthorization: meta.toolAuthorization,
                  getLlmOutputPolicy: meta.getLlmOutputPolicy,
                  setLlmOutputPolicy: meta.setLlmOutputPolicy,
                } as any);
                return suggestions.map((s) => ({ name: s.name, description: s.description }));
              }
            : undefined,
        };
      }

      const catalogEntry = skillBySlash.get(normalized);
      if (catalogEntry) {
        return {
          execute: async (req) => {
            // Tier 2: Activate skill on demand — load full SKILL.md content.
            // @see https://agentskills.io/specification — Progressive disclosure
            const skill = await skillLoader.activateSkill(catalogEntry.id);

            const meta = (req.meta ?? {}) as CommandContext;
            const signal = (meta as any)?.signal as AbortSignal | undefined;

            // Prepare an isolated worktree environment for governed shell execution.
            const silentEmit = (event: any) => {
              if (event?.type === 'log' && event?.level === 'error') {
                options.emit(event);
                return;
              }
              getLogger().debug(`[slash.skill] ${JSON.stringify(event)}`);
            };

            const env = new RuntimeEnvironment(
              {
                instruction: `slash:${skill.id}`,
                repoPath: options.repoRoot,
                strategy: 'worktree',
                dryRun: false,
                verbose: undefined,
              } as any,
              silentEmit as any,
            );

            try {
              await env.setup();
              const toolstack = await createStandardToolstack({
                repoRoot: env.activeRepoPath,
                persistenceRoot: options.repoRoot,
                worktreeRoot: env.activeRepoPath,
                attemptId: 0,
                dryRun: false,
                allowedToolNames: ['shell.exec'],
                authorizationProvider: options.authorizationProvider,
                authorizationMode: 'deferred',
              });

              const res = await executeSkill({
                skill,
                argsText: req.argsText,
                toolRouter: toolstack.router,
                toolCtx: {
                  repoRoot: env.activeRepoPath,
                  worktreeRoot: env.activeRepoPath,
                  persistenceRoot: options.repoRoot,
                  attemptId: 0,
                  dryRun: false,
                },
                signal,
              });

              if (res.status !== 'SUCCESS' || !res.injectedPrompt.trim()) {
                options.emit({
                  type: 'log',
                  level: 'error',
                  message: text.cli.skillNoPrompt(skill.id),
                  timestamp: new Date(),
                });
                return { kind: 'consumed' };
              }

              return { kind: 'rewrite', input: res.injectedPrompt };
            } finally {
              await env
                .teardown()
                .catch((error) => logIgnoredError('[SlashRuntime] env teardown failed', error));
            }
          },
        };
      }

      return undefined;
    },
  };

  const router = new SlashRouter({
    registry,
    handlers,
    unknownSlashPolicy: 'block',
  });

  const mapDecisionToDispatch = (decision: SlashDispatchDecision) => {
    if (decision.kind === 'consumed') return { type: 'executed' } as const;
    if (decision.kind === 'rewrite') {
      return { type: 'continue', trimmedInput: decision.input } as const;
    }
    if (decision.kind === 'forward') {
      return { type: 'continue', trimmedInput: decision.input } as const;
    }
    if (decision.kind === 'block') {
      if (decision.code === 'UNKNOWN_SLASH') {
        const cmd = String(decision.details?.commandName ?? '');
        const firstWord = cmd.split(/\s+/)[0] || cmd;
        const message = text.cli.unknownCommand(firstWord);
        return { type: 'blocked', reason: message } as const;
      }
      const message =
        decision.code === 'NO_HANDLER'
          ? text.cli.slashHandlerUnavailable
          : text.cli.slashInternalError;
      return { type: 'blocked', reason: message } as const;
    }
    return { type: 'executed' } as const;
  };

  const findCommand = (name: string) => commandTokenIndex.get(name.trim().toLowerCase());

  return {
    router,
    findCommand,
    async getSuggestions(input: string, context: CommandContext) {
      const items = await router.suggest(input, context);
      return items.map((i) => {
        const cmd = findCommand(i.commandName || i.name.trim());
        return { name: i.name, description: i.description, command: cmd };
      });
    },
    async dispatch(input: string, context: CommandContext) {
      const decision = await router.dispatch(input, context);
      const mapped = mapDecisionToDispatch(decision);
      if (mapped.type === 'blocked') {
        options.emit({
          type: 'log',
          level: 'error',
          message: mapped.reason,
          timestamp: new Date(),
        });
      }
      return mapped;
    },
  };
}
