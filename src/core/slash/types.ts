import type { ExecutionPhase } from '../types/index.js';

export interface SlashCommandSpec {
  name: string; // e.g. "/help"
  description: string;
  aliases?: string[];
  hidden?: boolean;
  order?: number;
}

export interface SlashParseResult {
  kind: 'slash' | 'text';
  raw: string;
  trimmed: string;
  commandName?: string; // normalized (lowercase), includes leading "/"
  argsText?: string; // raw remainder (may be empty)
  tokens?: string[]; // whitespace split args (best-effort)
  suggestion?: {
    argIndex: number;
    currentPrefix: string;
    isSpaceTrailing: boolean;
  };
}

export interface SlashSuggestionItem {
  name: string;
  description: string;
  hidden?: boolean;
  order?: number;
}

export interface SlashRegistryDiagnostics {
  conflicts: Array<{
    existing: string;
    incoming: string;
    reason: 'name' | 'alias';
    token: string;
  }>;
}

export interface SlashRegistry {
  find(commandOrAlias: string): SlashCommandSpec | undefined;
  list(): SlashCommandSpec[];
  suggest(prefix: string): SlashSuggestionItem[];
  diagnostics(): SlashRegistryDiagnostics;
}

export interface SlashHandlerRequest {
  rawInput: string;
  command: SlashCommandSpec;
  argsText: string;
  tokens: string[];
  meta?: unknown;
}

export type SlashHandlerResult =
  | { kind: 'consumed' }
  | { kind: 'rewrite'; input: string }
  | { kind: 'forward'; input: string };

export interface SlashHandlerProvider {
  getHandler(commandName: string): SlashHandler | undefined;
}

export interface SlashHandler {
  execute(req: SlashHandlerRequest): Promise<SlashHandlerResult> | SlashHandlerResult;
  getSuggestions?: (
    req: Omit<SlashHandlerRequest, 'tokens'> & { tokens: string[] },
  ) => Promise<SlashSuggestionItem[]> | SlashSuggestionItem[];
}

export interface SlashRouterOptions {
  registry: SlashRegistry;
  handlers: SlashHandlerProvider;
  unknownSlashPolicy: 'block' | 'forward_as_text';
  phase?: ExecutionPhase;
}

export type SlashDispatchDecision =
  | { kind: 'consumed' }
  | { kind: 'rewrite'; input: string }
  | { kind: 'forward'; input: string }
  | { kind: 'block'; code: 'UNKNOWN_SLASH' | 'NO_HANDLER' | 'INTERNAL_ERROR'; details?: any };
