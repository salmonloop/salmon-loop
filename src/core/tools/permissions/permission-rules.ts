import { text } from '../../../locales/index.js';
import { normalizeDiff, validateDiff } from '../../patch/diff.js';
import { ArtifactStore } from '../../sub-agent/artifacts/store.js';
import type { ToolRuntimeCtx } from '../types.js';

export type PermissionRuleAliasTool =
  | 'Bash'
  | 'Read'
  | 'Edit'
  | 'LS'
  | 'Grep'
  | 'Glob'
  | 'WebFetch';

export type PermissionRuleTool = PermissionRuleAliasTool | string;

export type PermissionEffect = 'allow' | 'deny';

export interface RawPermissionRulesInput {
  allow?: string[] | undefined;
  deny?: string[] | undefined;
}

export interface PermissionRuleParseError {
  raw: string;
  message: string;
}

export interface ParsedPermissionRule {
  tool: PermissionRuleTool;
  specifier?: string;
  raw: string;
}

export interface ParsePermissionRulesResult {
  ok: boolean;
  rules: ParsedPermissionRule[];
  errors: PermissionRuleParseError[];
}

export interface CompiledPermissionRule {
  effect: PermissionEffect;
  tool: PermissionRuleTool;
  raw: string;
  specifier?: string;
  compiled:
    | { kind: 'tool_any' }
    | { kind: 'bash'; matcher: BashCommandMatcher }
    | { kind: 'path'; matcher: PathMatcher }
    | { kind: 'edit'; matcher: PathMatcher };
}

export interface CompiledPermissionRules {
  allow: CompiledPermissionRule[];
  deny: CompiledPermissionRule[];
  /**
   * When true, tool calls that do not match any allow rule are denied
   * (after applying baseline exemptions).
   */
  enforceAllowRules: boolean;
  /**
   * Best-effort tool visibility list derived from allow rules.
   * This is intentionally conservative and should not be used for authorization.
   */
  visibleToolNamesFromAllow: Set<string>;
}

export type PermissionDecision =
  | {
      kind: 'allow';
      reason?: string;
      rule?: { effect: PermissionEffect; raw: string; tool: PermissionRuleTool };
    }
  | {
      kind: 'deny';
      reason: string;
      rule?: { effect: PermissionEffect; raw: string; tool: PermissionRuleTool };
    }
  | { kind: 'no_match' };

const DEFAULT_TOOL_ALIASES: Record<string, PermissionRuleAliasTool> = {
  bash: 'Bash',
  read: 'Read',
  edit: 'Edit',
  ls: 'LS',
  grep: 'Grep',
  glob: 'Glob',
  webfetch: 'WebFetch',
};

const BASELINE_TOOL_NAMES = new Set<string>(['plan.init', 'plan.read', 'plan.update']);

const ALIAS_TOOL_TO_INTERNAL_TOOL_NAMES: Record<PermissionRuleAliasTool, string[]> = {
  Bash: ['shell.exec', 'test.run'],
  Read: ['fs.read', 'code.read', 'git.cat', 'artifact.read'],
  Edit: ['proposal.apply'],
  LS: ['fs.list', 'git.status'],
  Grep: ['code.search'],
  Glob: ['code.search'],
  WebFetch: [],
};

function isAliasToolName(tool: string): tool is PermissionRuleAliasTool {
  return Boolean(
    DEFAULT_TOOL_ALIASES[
      String(tool || '')
        .trim()
        .toLowerCase()
    ],
  );
}

function canonicalizeToolName(tool: string): PermissionRuleTool {
  const normalized = String(tool || '').trim();
  const key = normalized.toLowerCase();
  return DEFAULT_TOOL_ALIASES[key] ?? normalized;
}

function parseRuleString(
  raw: string,
): { ok: true; rule: ParsedPermissionRule } | { ok: false; error: PermissionRuleParseError } {
  const original = String(raw ?? '');
  const trimmed = original.trim();
  if (!trimmed) {
    return { ok: false, error: { raw: original, message: 'Rule is empty' } };
  }

  const open = trimmed.indexOf('(');
  if (open === -1) {
    return {
      ok: true,
      rule: {
        raw: trimmed,
        tool: canonicalizeToolName(trimmed),
      },
    };
  }

  if (!trimmed.endsWith(')')) {
    return {
      ok: false,
      error: { raw: trimmed, message: 'Rule has "(" but does not end with ")"' },
    };
  }

  const toolPart = trimmed.slice(0, open).trim();
  const specifier = trimmed.slice(open + 1, -1).trim();
  if (!toolPart) {
    return { ok: false, error: { raw: trimmed, message: 'Rule tool name is missing' } };
  }
  if (!specifier) {
    return { ok: true, rule: { raw: trimmed, tool: canonicalizeToolName(toolPart) } };
  }

  return {
    ok: true,
    rule: {
      raw: trimmed,
      tool: canonicalizeToolName(toolPart),
      specifier,
    },
  };
}

export function parsePermissionRules(input: RawPermissionRulesInput): ParsePermissionRulesResult {
  const rules: ParsedPermissionRule[] = [];
  const errors: PermissionRuleParseError[] = [];

  const all = [...(input.allow ?? []), ...(input.deny ?? [])];
  if (!Array.isArray(all)) {
    return { ok: true, rules: [], errors: [] };
  }

  for (const raw of all) {
    const parsed = parseRuleString(String(raw ?? ''));
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    rules.push(parsed.rule);
  }

  return { ok: errors.length === 0, rules, errors };
}

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface BashCommandMatcher {
  kind: 'all' | 'pattern';
  rawSpecifier?: string;
  matches: (command: string) => boolean;
  isExactMatch: (command: string) => boolean;
}

function normalizeDeprecatedBashSuffix(specifier: string): string {
  const s = String(specifier ?? '').trim();
  if (s.endsWith(':*')) {
    return `${s.slice(0, -2)} *`;
  }
  return s;
}

function commandHasShellOperatorsOutsideQuotes(command: string): boolean {
  const s = String(command ?? '');
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (ch === '\n' || ch === '\r') return true;

    if (!inSingle && !inDouble) {
      const next = s[i + 1] ?? '';
      if (ch === '&' && next === '&') return true;
      if (ch === '|' && next === '|') return true;
      if (ch === ';' || ch === '|' || ch === '>' || ch === '<') return true;
      if (ch === '`') return true;
      if (ch === '$' && next === '(') return true;
    } else if (!inSingle && inDouble) {
      const next = s[i + 1] ?? '';
      if (ch === '`') return true;
      if (ch === '$' && next === '(') return true;
    }
  }

  return false;
}

function compileBashMatcher(specifier?: string): BashCommandMatcher {
  const spec = normalizeDeprecatedBashSuffix(String(specifier ?? '').trim());
  if (!spec || spec === '*') {
    return {
      kind: 'all',
      rawSpecifier: specifier,
      matches: () => true,
      isExactMatch: () => false,
    };
  }

  const expanded = spec.endsWith(' *') ? [spec, spec.slice(0, -2)] : [spec];

  const exact = new Set<string>();
  const regexes: RegExp[] = [];

  for (const p of expanded) {
    if (!p.includes('*')) {
      exact.add(p);
      continue;
    }
    const parts = p.split('*').map(escapeRegExpLiteral);
    const re = new RegExp(`^${parts.join('.*')}$`);
    regexes.push(re);
  }

  const isExactMatch = (command: string) => exact.has(command);
  const matches = (command: string) => {
    if (commandHasShellOperatorsOutsideQuotes(command)) {
      // Wildcard safety: prefix/suffix/contains rules must not allow shell operator chaining.
      return isExactMatch(command);
    }

    if (isExactMatch(command)) return true;
    for (const re of regexes) {
      if (re.test(command)) return true;
    }
    return false;
  };

  return { kind: 'pattern', rawSpecifier: specifier, matches, isExactMatch };
}

export interface PathMatcher {
  rawSpecifier?: string;
  matches: (repoRelativePath: string) => boolean;
}

function normalizeRepoRelativePath(input: string): string {
  const raw = String(input ?? '')
    .replace(/\\/g, '/')
    .trim();
  const withoutDot = raw.replace(/^\.\//, '');
  const withoutLeadingSlash = withoutDot.replace(/^\/+/, '');
  return withoutLeadingSlash.replace(/\/{2,}/g, '/');
}

function compilePathMatcher(specifier?: string): PathMatcher {
  const spec = normalizeRepoRelativePath(String(specifier ?? '').trim());
  if (!spec || spec === '*') {
    return { rawSpecifier: specifier, matches: () => true };
  }

  const tokens: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    const next = spec[i + 1] ?? '';
    if (ch === '*' && next === '*') {
      tokens.push('**');
      i++;
      continue;
    }
    if (ch === '*') {
      tokens.push('*');
      continue;
    }
    tokens.push(ch);
  }

  const reBody = tokens
    .map((t) => {
      if (t === '**') return '.*';
      if (t === '*') return '[^/]*';
      return escapeRegExpLiteral(t);
    })
    .join('');

  const re = new RegExp(`^${reBody}$`);
  return {
    rawSpecifier: specifier,
    matches: (repoRelativePath: string) => re.test(normalizeRepoRelativePath(repoRelativePath)),
  };
}

function compileRule(
  effect: PermissionEffect,
  parsed: ParsedPermissionRule,
): CompiledPermissionRule {
  const tool = parsed.tool;
  const specifier = parsed.specifier;

  const asAlias =
    typeof tool === 'string' && isAliasToolName(tool) ? (tool as PermissionRuleAliasTool) : null;

  const shouldTreatAsBash =
    tool === 'Bash' ||
    tool === 'bash' ||
    tool === 'shell.exec' ||
    tool === 'test.run' ||
    asAlias === 'Bash';

  const shouldTreatAsEdit =
    tool === 'Edit' || tool === 'edit' || tool === 'proposal.apply' || asAlias === 'Edit';

  const shouldTreatAsPath =
    tool === 'Read' ||
    tool === 'read' ||
    tool === 'LS' ||
    tool === 'ls' ||
    tool === 'fs.read' ||
    tool === 'code.read' ||
    tool === 'git.cat' ||
    tool === 'fs.list' ||
    tool === 'artifact.read' ||
    asAlias === 'Read' ||
    asAlias === 'LS';

  if (shouldTreatAsBash) {
    return {
      effect,
      tool,
      raw: parsed.raw,
      specifier,
      compiled: { kind: 'bash', matcher: compileBashMatcher(specifier) },
    };
  }

  if (shouldTreatAsEdit) {
    return {
      effect,
      tool,
      raw: parsed.raw,
      specifier,
      compiled: { kind: 'edit', matcher: compilePathMatcher(specifier) },
    };
  }

  if (shouldTreatAsPath) {
    return {
      effect,
      tool,
      raw: parsed.raw,
      specifier,
      compiled: { kind: 'path', matcher: compilePathMatcher(specifier) },
    };
  }

  return { effect, tool, raw: parsed.raw, specifier, compiled: { kind: 'tool_any' } };
}

function buildVisibleToolNamesFromAllow(allowRules: CompiledPermissionRule[]): Set<string> {
  const visible = new Set<string>();
  for (const rule of allowRules) {
    const tool = rule.tool;
    if (typeof tool === 'string' && isAliasToolName(tool)) {
      for (const name of ALIAS_TOOL_TO_INTERNAL_TOOL_NAMES[tool as PermissionRuleAliasTool] ?? []) {
        visible.add(name);
      }
      continue;
    }
    if (typeof tool === 'string' && (tool.includes('.') || tool.includes('_'))) {
      visible.add(tool);
    }
  }
  for (const baseline of BASELINE_TOOL_NAMES) visible.add(baseline);
  return visible;
}

export function compilePermissionRules(input: RawPermissionRulesInput): {
  ok: boolean;
  compiled?: CompiledPermissionRules;
  errors?: PermissionRuleParseError[];
} {
  const parsedAllow = (input.allow ?? []).flatMap((raw) => {
    const res = parseRuleString(String(raw ?? ''));
    return res.ok ? [res.rule] : [];
  });
  const parsedDeny = (input.deny ?? []).flatMap((raw) => {
    const res = parseRuleString(String(raw ?? ''));
    return res.ok ? [res.rule] : [];
  });

  const parseAll = parsePermissionRules(input);
  if (!parseAll.ok) {
    return { ok: false, errors: parseAll.errors };
  }

  const allow = parsedAllow.map((r) => compileRule('allow', r));
  const deny = parsedDeny.map((r) => compileRule('deny', r));

  return {
    ok: true,
    compiled: {
      allow,
      deny,
      enforceAllowRules: allow.length > 0,
      visibleToolNamesFromAllow: buildVisibleToolNamesFromAllow(allow),
    },
  };
}

function toolMatchesRuleTool(toolName: string, ruleTool: PermissionRuleTool): boolean {
  if (typeof ruleTool !== 'string') return false;

  if (isAliasToolName(ruleTool)) {
    const internal = ALIAS_TOOL_TO_INTERNAL_TOOL_NAMES[ruleTool as PermissionRuleAliasTool] ?? [];
    return internal.includes(toolName);
  }

  return toolName === ruleTool;
}

function extractPrimaryPathArg(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const obj = args as Record<string, any>;

  if (toolName === 'fs.read' || toolName === 'code.read')
    return typeof obj.file === 'string' ? obj.file : undefined;
  if (toolName === 'git.cat') return typeof obj.file === 'string' ? obj.file : undefined;
  if (toolName === 'fs.list') return typeof obj.path === 'string' ? obj.path : undefined;

  return undefined;
}

function extractCommandArg(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const obj = args as Record<string, any>;
  if (toolName === 'shell.exec') return typeof obj.command === 'string' ? obj.command : undefined;
  if (toolName === 'test.run') return typeof obj.command === 'string' ? obj.command : undefined;
  return undefined;
}

async function loadProposalChangedFiles(handle: string): Promise<string[] | null> {
  const read = await ArtifactStore.readText(handle);
  if (!read.ok) return null;
  try {
    const normalized = normalizeDiff(read.content);
    const meta = validateDiff(normalized);
    return meta.changedFiles ?? [];
  } catch {
    return null;
  }
}

function matchAllowRule(rule: CompiledPermissionRule, toolName: string, args: unknown): boolean {
  if (!toolMatchesRuleTool(toolName, rule.tool)) return false;

  if (rule.compiled.kind === 'tool_any') return true;
  if (rule.compiled.kind === 'bash') {
    const cmd = extractCommandArg(toolName, args);
    if (!cmd) return false;
    return rule.compiled.matcher.matches(cmd);
  }
  if (rule.compiled.kind === 'path') {
    const p = extractPrimaryPathArg(toolName, args);
    if (!p) return false;
    return rule.compiled.matcher.matches(p);
  }
  if (rule.compiled.kind === 'edit') {
    // Edit allow rules are handled by an async path-aware matcher.
    return toolName === 'proposal.apply';
  }
  return false;
}

async function matchAllowEditRule(rule: CompiledPermissionRule, args: unknown): Promise<boolean> {
  if (rule.compiled.kind !== 'edit') return false;
  const matcher = rule.compiled.matcher;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const handle = (args as any).handle;
  if (typeof handle !== 'string' || !handle.trim()) return false;

  const changedFiles = await loadProposalChangedFiles(handle);
  if (!changedFiles) return false;
  if (changedFiles.length === 0) return false;
  return changedFiles.every((p) => matcher.matches(p));
}

async function matchDenyEditRule(rule: CompiledPermissionRule, args: unknown): Promise<boolean> {
  if (rule.compiled.kind !== 'edit') return false;
  const matcher = rule.compiled.matcher;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const handle = (args as any).handle;
  if (typeof handle !== 'string' || !handle.trim()) return false;
  const changedFiles = await loadProposalChangedFiles(handle);
  if (!changedFiles) return false;
  return changedFiles.some((p) => matcher.matches(p));
}

function matchDenyRule(rule: CompiledPermissionRule, toolName: string, args: unknown): boolean {
  if (!toolMatchesRuleTool(toolName, rule.tool)) return false;

  if (rule.compiled.kind === 'tool_any') return true;
  if (rule.compiled.kind === 'bash') {
    const cmd = extractCommandArg(toolName, args);
    if (!cmd) return false;
    return rule.compiled.matcher.matches(cmd);
  }
  if (rule.compiled.kind === 'path') {
    const p = extractPrimaryPathArg(toolName, args);
    if (!p) return false;
    return rule.compiled.matcher.matches(p);
  }
  if (rule.compiled.kind === 'edit') {
    // Deny edit rules are handled by an async path-aware matcher.
    return toolName === 'proposal.apply';
  }
  return false;
}

export async function decidePermissionForToolCall(options: {
  rules?: CompiledPermissionRules | undefined;
  toolName: string;
  args: unknown;
  ctx: ToolRuntimeCtx;
}): Promise<PermissionDecision> {
  const rules = options.rules;
  if (!rules) return { kind: 'no_match' };

  if (BASELINE_TOOL_NAMES.has(options.toolName)) {
    return { kind: 'allow', reason: 'baseline' };
  }

  // Deny rules win.
  for (const rule of rules.deny) {
    if (rule.compiled.kind === 'edit') {
      if (options.toolName === 'proposal.apply' && (await matchDenyEditRule(rule, options.args))) {
        return {
          kind: 'deny',
          reason: text.tools.permissionRuleDenied(rule.raw),
          rule: { effect: 'deny', raw: rule.raw, tool: rule.tool },
        };
      }
      continue;
    }
    if (matchDenyRule(rule, options.toolName, options.args)) {
      return {
        kind: 'deny',
        reason: text.tools.permissionRuleDenied(rule.raw),
        rule: { effect: 'deny', raw: rule.raw, tool: rule.tool },
      };
    }
  }

  for (const rule of rules.allow) {
    if (rule.compiled.kind === 'edit') {
      if (options.toolName === 'proposal.apply' && (await matchAllowEditRule(rule, options.args))) {
        return {
          kind: 'allow',
          reason: rule.raw,
          rule: { effect: 'allow', raw: rule.raw, tool: rule.tool },
        };
      }
      continue;
    }
    if (matchAllowRule(rule, options.toolName, options.args)) {
      return {
        kind: 'allow',
        reason: rule.raw,
        rule: { effect: 'allow', raw: rule.raw, tool: rule.tool },
      };
    }
  }

  if (rules.enforceAllowRules) {
    return {
      kind: 'deny',
      reason: text.tools.permissionRulesRequired(),
    };
  }

  return { kind: 'no_match' };
}

export function shouldFilterRegistryByAllowRules(
  rules?: CompiledPermissionRules | undefined,
): boolean {
  return Boolean(rules && rules.allow.length > 0);
}

export function getVisibleToolNamesFromAllowRules(
  rules?: CompiledPermissionRules | undefined,
): Set<string> {
  if (!rules) return new Set();
  return new Set(rules.visibleToolNamesFromAllow);
}
