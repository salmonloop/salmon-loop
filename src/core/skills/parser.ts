import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { text } from '../../locales/index.js';
import { getLogger, tryGetLogger } from '../observability/logger.js';

import { Skill, SkillCatalogEntry, SkillFrontmatter } from './types.js';

/**
 * Zod schema for strict SKILL.md frontmatter validation.
 *
 * Enforces AgentSkills naming conventions and type correctness:
 * - `name`: 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens
 * - `description`: 1-1024 chars, non-empty
 * - `userInvocable`: coerced to boolean (handles string "true"/"false" from YAML)
 *
 * @see Requirements 5.1, 5.2, 5.4, 5.5
 */
export const SkillFrontmatterSchema = z.object({
  // AgentSkills spec: "unicode lowercase alphanumeric characters (a-z) and
  // hyphens (-)". We follow the spec and accept Unicode lowercase letters
  // (\p{Ll}) and Unicode digits (\p{N}) in addition to ASCII, using the
  // `u` flag for Unicode property escapes.
  name: z.string()
    .min(1)
    .max(64)
    .regex(
      /^[\p{Ll}\p{N}](?:[\p{Ll}\p{N}-]*[\p{Ll}\p{N}])?$/u,
      'name must be unicode lowercase alphanumeric + hyphens per AgentSkills spec',
    )
    .refine(s => !s.includes('--'), 'name must not contain consecutive hyphens'),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  // AgentSkills spec: "Space-delimited list of pre-approved tools" (Experimental).
  // Accept both a plain string ("tool-a tool-b") and a YAML array (["tool-a", "tool-b"])
  // to avoid rejecting valid skill files that use either notation.
  'allowed-tools': z.preprocess(
    (val) => {
      if (Array.isArray(val)) return val.join(' ');
      return val;
    },
    z.string().optional(),
  ),
  // SalmonLoop extension: array form for internal use
  allowedTools: z.preprocess(
    (val) => {
      if (typeof val === 'string') return val.split(/\s+/).filter(Boolean);
      return val;
    },
    z.array(z.string()).optional(),
  ),
  context: z.enum(['fork', 'main']).optional(),
  userInvocable: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true;
        if (val.toLowerCase() === 'false') return false;
      }
      return val;
    },
    z.boolean().optional().default(true),
  ),
  paths: z.array(z.string()).optional(),
});

/**
 * Maximum allowed length for a single extracted command (in characters).
 *
 * This limit mitigates denial-of-service via extremely long command strings and
 * reduces the blast radius of any injection that bypasses pattern checks.
 * The value (4096) aligns with common OS `ARG_MAX` per-argument limits.
 *
 * @security Guard — enforced inside {@link SkillParser.extractCommands}.
 */
export const COMMAND_MAX_LENGTH = 4096;

/** Control character range that must not appear in commands (C0 subset excluding tab, LF, CR). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0e-\x1f]/;

/**
 * Default deny-list of dangerous shell patterns.
 *
 * Each regex targets a well-known destructive or injection-prone idiom:
 *
 * | Pattern               | Threat                                          |
 * |-----------------------|-------------------------------------------------|
 * | `rm -rf /`            | Recursive root deletion                         |
 * | `curl … \| sh`        | Remote code execution via piped download         |
 * | `\beval\b`            | Arbitrary code evaluation in shell               |
 * | `\bexec\b.*<`         | Process replacement with redirected input        |
 *
 * The list is intentionally conservative — it catches blatant patterns but does
 * NOT attempt full shell-syntax analysis.  Callers may supply their own list via
 * the `dangerousPatterns` parameter of {@link SkillParser.extractCommands}.
 *
 * @security Guard — applied after length and control-character checks.
 */
export const DEFAULT_DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  /rm\s+-rf\s+\//,
  /curl\s.*\|\s*sh/,
  /\beval\b/,
  /\bexec\b.*</,
];

export class SkillParser {
  /**
   * Parse a SKILL.md file with strict YAML frontmatter validation.
   *
   * Uses the `yaml` library for robust YAML parsing and Zod schema for
   * field validation and type coercion. Throws on missing or invalid
   * frontmatter instead of silently falling back.
   *
   * After schema validation, compares `data.name` with the parent directory
   * name extracted from `filePath`. In strict mode (default), a mismatch
   * throws an error. In compat mode (`strict=false`), a warning is logged.
   *
   * @param content - Raw SKILL.md file content
   * @param filePath - Absolute or relative path to the SKILL.md file
   * @param strict - When true (default), reject on name-directory mismatch; when false, warn only
   * @throws Error if frontmatter is missing, YAML is malformed, schema validation fails,
   *   or (in strict mode) name does not match parent directory
   * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5
   */
  static parse(content: string, filePath: string, strict: boolean = true): Skill {
    // Accept frontmatter with or without a body after the closing ---.
    // The body capture is optional to avoid rejecting minimal SKILL.md files
    // that contain only frontmatter (no trailing newline or instruction text).
    const yamlRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;
    const match = content.match(yamlRegex);

    if (!match) {
      const msg = text.skills.missingFrontmatter(filePath);
      getLogger().error(msg);
      throw new Error(msg);
    }

    const yamlRaw = match[1];
    const instructions = match[2] ?? '';

    let parsed: unknown;
    try {
      parsed = parseYaml(yamlRaw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const msg = text.skills.yamlParseError(filePath, reason);
      getLogger().error(msg);
      throw new Error(msg);
    }

    if (parsed == null || typeof parsed !== 'object') {
      const msg = text.skills.missingFrontmatter(filePath);
      getLogger().error(msg);
      throw new Error(msg);
    }

    const result = SkillFrontmatterSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      const msg = text.skills.invalidFrontmatter(filePath, issues);
      getLogger().error(msg);
      throw new Error(msg);
    }

    const data = result.data as SkillFrontmatter;

    // Validate name matches parent directory (Requirement 5.3)
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && parentDir !== '.' && parentDir !== data.name) {
      const msg = text.skills.nameDirMismatch(filePath, parentDir, data.name);
      if (strict) {
        getLogger().error(msg);
        throw new Error(msg);
      } else {
        getLogger().warn(msg);
      }
    }

    return {
      id: data.name,
      path: filePath,
      metadata: data,
      rawContent: content,
      instructions: instructions.trim(),
    };
  }

  /**
   * Parse only the YAML frontmatter of a SKILL.md file (Tier 1 catalog loading).
   *
   * Extracts name, description, and optional conditional paths without reading
   * the full instruction body. This keeps startup context cost at approximately
   * 50-100 tokens per skill.
   *
   * @param content - Raw SKILL.md file content
   * @param filePath - Absolute or relative path to the SKILL.md file
   * @param scope - Discovery scope for the catalog entry
   * @param strict - When true (default), reject on name-directory mismatch
   * @returns A lightweight {@link SkillCatalogEntry} or throws on invalid frontmatter
   * @see Requirements 6.1, 6.3
   */
  static parseFrontmatterOnly(
    content: string,
    filePath: string,
    scope: 'repo' | 'user' | 'config',
    strict: boolean = true,
  ): SkillCatalogEntry {
    const yamlRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(yamlRegex);

    if (!match) {
      const msg = text.skills.missingFrontmatter(filePath);
      getLogger().error(msg);
      throw new Error(msg);
    }

    const yamlRaw = match[1];

    let parsed: unknown;
    try {
      parsed = parseYaml(yamlRaw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const msg = text.skills.yamlParseError(filePath, reason);
      getLogger().error(msg);
      throw new Error(msg);
    }

    if (parsed == null || typeof parsed !== 'object') {
      const msg = text.skills.missingFrontmatter(filePath);
      getLogger().error(msg);
      throw new Error(msg);
    }

    const result = SkillFrontmatterSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      const msg = text.skills.invalidFrontmatter(filePath, issues);
      getLogger().error(msg);
      throw new Error(msg);
    }

    const data = result.data as SkillFrontmatter;

    // Validate name matches parent directory (Requirement 5.3)
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && parentDir !== '.' && parentDir !== data.name) {
      const msg = text.skills.nameDirMismatch(filePath, parentDir, data.name);
      if (strict) {
        getLogger().error(msg);
        throw new Error(msg);
      } else {
        getLogger().warn(msg);
      }
    }

    return {
      id: data.name,
      name: data.name,
      description: data.description,
      location: filePath,
      scope,
      conditionalPaths: data.paths,
    };
  }

  static substituteVariables(template: string, args: Record<string, string>): string {
    let result = template;
    // Sort keys by length descending to prevent shorter keys from replacing parts of longer keys
    const sortedKeys = Object.keys(args).sort((a, b) => b.length - a.length);

    // Track original content to prevent infinite recursion if a value contains its own key
    // We use a single pass approach by replacing markers
    const markers = new Map<string, string>();
    let processedTemplate = template;

    for (let i = 0; i < sortedKeys.length; i++) {
      const key = sortedKeys[i];
      const value = args[key];
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const marker = `__SKILL_VAR_${i}__`;

      const regex = new RegExp(`\\$${escapedKey}\\b|\\$\\{${escapedKey}\\}`, 'g');
      processedTemplate = processedTemplate.replace(regex, marker);
      markers.set(marker, value);
    }

    // Second pass: Replace markers with actual values to ensure no recursion
    result = processedTemplate;
    for (const [marker, value] of markers.entries()) {
      result = result.replace(new RegExp(marker, 'g'), () => value);
    }

    return result;
  }

  /**
   * Extract shell commands from skill instruction markdown.
   *
   * ## Regex: `/^!(?:sh\s+)?(.*)$/gm`
   *
   * ### What it matches
   * Lines that begin with `!` are treated as command directives.  Two forms are
   * recognised:
   *
   * - `!sh <command>` — explicit shell prefix (the `sh ` prefix is consumed,
   *   only `<command>` is captured).
   * - `!<command>`    — shorthand without the `sh` keyword.
   *
   * The `m` (multiline) flag makes `^` / `$` match per-line, so every command
   * line in a multi-line instruction block is extracted independently.
   *
   * ### What it intentionally excludes
   * - Lines that do NOT start with `!` (regular markdown prose).
   * - The `!` prefix itself and the optional `sh ` token — only the payload
   *   after them is captured in group 1.
   * - Empty captures are filtered out after extraction (`trim().length > 0`).
   *
   * ### Security implications
   *
   * 1. **Greedy `(.*)` capture** — the capture group accepts any character
   *    (except newline) without restriction.  This means the regex alone does
   *    NOT prevent shell metacharacters, variable expansion, pipes, or
   *    subshell invocations from appearing in the captured command.
   *
   * 2. **Multiline mode (`m` flag)** — each line is evaluated independently.
   *    An attacker cannot splice two lines into a single command via the regex
   *    itself, but embedded newlines within a single logical line (e.g. via
   *    `\n` literals in a YAML value) would not be caught by `^…$` anchors.
   *    The control-character filter below mitigates this.
   *
   * 3. **No shell-syntax parsing** — the regex performs plain text extraction;
   *    it has no awareness of quoting, escaping, or shell grammar.  Security
   *    therefore relies on the downstream guard chain, NOT on the regex.
   *
   * ### Downstream security guards (defense-in-depth)
   *
   * The following guards are applied sequentially after extraction to mitigate
   * the risks above:
   *
   * | Guard                    | Constant / Pattern          | Purpose                                    |
   * |--------------------------|-----------------------------|--------------------------------------------|
   * | Max length               | {@link COMMAND_MAX_LENGTH}  | Caps command size to 4096 chars             |
   * | Control-char rejection   | `CONTROL_CHAR_PATTERN`      | Blocks C0 control chars (except tab/LF/CR) |
   * | Dangerous-pattern filter | {@link DEFAULT_DANGEROUS_PATTERNS} | Rejects known destructive idioms     |
   * | Audit logging            | `SKILL_COMMANDS_EXTRACTED`  | Logs all surviving commands for review      |
   *
   * @param instructions - Raw skill instruction text (may contain markdown).
   * @param dangerousPatterns - Optional override for the dangerous-pattern
   *   deny-list.  Defaults to {@link DEFAULT_DANGEROUS_PATTERNS}.
   * @returns Array of sanitised command strings ready for governed execution
   *   via ToolRouter.
   *
   * @security Requirement 8.4 — command extraction regex documented with
   *   security implications.
   */
  static extractCommands(
    instructions: string,
    dangerousPatterns: ReadonlyArray<RegExp> = DEFAULT_DANGEROUS_PATTERNS,
  ): string[] {
    const commandRegex = /^!(?:sh\s+)?(.*)$/gm;
    const matches = instructions.matchAll(commandRegex);
    const raw = Array.from(matches, (m) => m[1].trim()).filter((cmd) => cmd.length > 0);

    const logger = tryGetLogger();

    const safe = raw.filter((cmd) => {
      if (cmd.length > COMMAND_MAX_LENGTH) {
        logger?.warn(`Skill command rejected: exceeds max length (${cmd.length} > ${COMMAND_MAX_LENGTH})`);
        return false;
      }

      if (CONTROL_CHAR_PATTERN.test(cmd)) {
        logger?.warn('Skill command rejected: contains control characters');
        return false;
      }

      const matched = dangerousPatterns.find((p) => p.test(cmd));
      if (matched) {
        logger?.warn(`Skill command rejected: matches dangerous pattern ${matched}`);
        return false;
      }

      return true;
    });

    // Audit: log all commands that will be executed
    if (safe.length > 0) {
      logger?.audit('SKILL_COMMANDS_EXTRACTED', {
        commandCount: safe.length,
        commands: safe,
      }, { source: 'skill-parser', severity: 'low', scope: 'session' });
    }

    return safe;
  }
}
