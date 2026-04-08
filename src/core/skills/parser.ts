import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { text } from '../../locales/index.js';
import { tryGetLogger } from '../observability/logger.js';

import { Skill, SkillCatalogEntry, SkillFrontmatter } from './types.js';

/**
 * Safe logger accessor that never throws when the logger is not yet initialized.
 *
 * Falls back to a no-op stub so that parser code can run in test environments
 * or early startup paths where the global logger has not been set.
 */
function safeLogger() {
  return tryGetLogger() ?? {
    error: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    info: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    audit: (..._args: unknown[]) => {},
  };
}

/**
 * Naming convention regex for AgentSkills spec compliance.
 *
 * AgentSkills spec: "unicode lowercase alphanumeric characters (a-z) and
 * hyphens (-)". We accept Unicode lowercase letters (\p{Ll}) and Unicode
 * digits (\p{N}) in addition to ASCII, using the `u` flag for Unicode
 * property escapes.
 */
const SKILL_NAME_REGEX = /^[\p{Ll}\p{N}](?:[\p{Ll}\p{N}-]*[\p{Ll}\p{N}])?$/u;

/** Shared field definitions for non-name/description fields used by both schemas. */
const sharedFields = {
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  // AgentSkills spec: "Space-delimited list of pre-approved tools" (Experimental).
  // Accept both a plain string ("tool-a tool-b") and a YAML array (["tool-a", "tool-b"])
  // to avoid rejecting valid skill files that use either notation.
  // YAML bare key (`allowed-tools:`) parses as null — normalize to undefined
  // so that Zod's `.optional()` accepts it as "not declared".
  'allowed-tools': z.preprocess(
    (val) => {
      if (val === null || val === undefined) return undefined;
      if (Array.isArray(val)) return val.join(' ');
      return val;
    },
    z.string().optional(),
  ),
  // SalmonLoop extension: array form for internal use
  // YAML bare key (`allowedTools:`) parses as null — normalize to undefined.
  allowedTools: z.preprocess(
    (val) => {
      if (val === null || val === undefined) return undefined;
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
} as const;

/**
 * Base Zod schema for SKILL.md frontmatter with fatal-only constraints.
 *
 * Only enforces requirements that MUST cause a skill to be skipped:
 * - `name`: must be a non-empty string (identity is required)
 * - `description`: must be a non-empty string (essential for catalog disclosure)
 *
 * Non-fatal constraints (name length, name format, description length) are
 * checked separately in lenient mode and logged as warnings.
 *
 * @see Requirements 1.1, 1.2, 1.3, 1.5, 1.6
 */
export const SkillFrontmatterBaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  ...sharedFields,
});

/**
 * Strict Zod schema for SKILL.md frontmatter validation.
 *
 * Enforces AgentSkills naming conventions and type correctness:
 * - `name`: 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens
 * - `description`: 1-1024 chars, non-empty
 * - `userInvocable`: coerced to boolean (handles string "true"/"false" from YAML)
 *
 * @see Requirements 5.1, 5.2, 5.4, 5.5
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string()
    .min(1)
    .max(64)
    .regex(
      SKILL_NAME_REGEX,
      'name must be unicode lowercase alphanumeric + hyphens per AgentSkills spec',
    )
    .refine(s => !s.includes('--'), 'name must not contain consecutive hyphens'),
  description: z.string().min(1).max(1024),
  ...sharedFields,
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
   * Parse a SKILL.md file with YAML frontmatter validation.
   *
   * Uses the `yaml` library for robust YAML parsing and Zod schema for
   * field validation and type coercion. Throws on missing or invalid
   * frontmatter instead of silently falling back.
   *
   * After schema validation, compares `data.name` with the parent directory
   * name extracted from `filePath`. In strict mode, a mismatch throws an
   * error. In lenient mode (default), a warning is logged.
   *
   * In lenient mode (`strict=false`), non-fatal constraint violations
   * (name length >64, name regex, description length >1024) produce
   * warnings but still load the skill. In strict mode (`strict=true`),
   * these violations cause the skill to be rejected.
   *
   * @param content - Raw SKILL.md file content
   * @param filePath - Absolute or relative path to the SKILL.md file
   * @param strict - When true, reject on non-fatal violations; when false (default), warn only
   * @throws Error if frontmatter is missing, YAML is malformed, schema validation fails,
   *   or (in strict mode) name does not match parent directory
   * @see Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 1.9, 1.10
   */
  static parse(content: string, filePath: string, strict: boolean = false): Skill {
    // Accept frontmatter with or without a body after the closing ---.
    // The body capture is optional to avoid rejecting minimal SKILL.md files
    // that contain only frontmatter (no trailing newline or instruction text).
    const yamlRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;
    const match = content.match(yamlRegex);

    if (!match) {
      const msg = text.skills.missingFrontmatter(filePath);
      safeLogger().error(msg);
      throw new Error(msg);
    }

    const yamlRaw = match[1];
    const instructions = match[2] ?? '';

    let parsed: unknown;
    try {
      parsed = parseYaml(yamlRaw);
    } catch (originalErr) {
      // Attempt YAML fallback recovery
      const { fixed, correctedLines } = SkillParser.fixCommonYamlIssues(yamlRaw);
      try {
        parsed = parseYaml(fixed);
        // Fallback succeeded — log warning identifying corrected lines
        safeLogger().warn(text.skills.yamlFallbackApplied(filePath, correctedLines.join(', ')));
      } catch (_fallbackErr) {
        // Fallback also failed — log original error and throw
        const reason = originalErr instanceof Error ? originalErr.message : String(originalErr);
        safeLogger().warn(text.skills.yamlFallbackFailed(filePath));
        const msg = text.skills.yamlParseError(filePath, reason);
        safeLogger().error(msg);
        throw new Error(msg);
      }
    }

    if (parsed == null || typeof parsed !== 'object') {
      const msg = text.skills.missingFrontmatter(filePath);
      safeLogger().error(msg);
      throw new Error(msg);
    }

    const schema = strict ? SkillFrontmatterSchema : SkillFrontmatterBaseSchema;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      const msg = text.skills.invalidFrontmatter(filePath, issues);
      safeLogger().error(msg);
      throw new Error(msg);
    }

    const data = result.data as SkillFrontmatter;

    // In lenient mode, check non-fatal constraints and log warnings
    if (!strict) {
      if (data.name.length > 64) {
        safeLogger().warn(text.skills.nameTooLong(filePath, data.name, data.name.length));
      }
      if (!SKILL_NAME_REGEX.test(data.name) || data.name.includes('--')) {
        safeLogger().warn(text.skills.nameFormatWarning(filePath, data.name));
      }
      if (data.description.length > 1024) {
        safeLogger().warn(text.skills.descriptionTooLong(filePath, data.description.length));
      }
    }

    // Validate name matches parent directory (Requirement 5.3)
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && parentDir !== '.' && parentDir !== data.name) {
      const msg = text.skills.nameDirMismatch(filePath, parentDir, data.name);
      if (strict) {
        safeLogger().error(msg);
        throw new Error(msg);
      } else {
        safeLogger().warn(msg);
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
   * In lenient mode (`strict=false`, default), non-fatal constraint violations
   * produce warnings but still load the catalog entry. In strict mode, these
   * violations cause the entry to be rejected.
   *
   * @param content - Raw SKILL.md file content
   * @param filePath - Absolute or relative path to the SKILL.md file
   * @param scope - Discovery scope for the catalog entry
   * @param strict - When true, reject on non-fatal violations; when false (default), warn only
   * @returns A lightweight {@link SkillCatalogEntry} or throws on invalid frontmatter
   * @see Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 6.1, 6.3
   */
  static parseFrontmatterOnly(
    content: string,
    filePath: string,
    scope: 'repo' | 'user' | 'config',
    strict: boolean = false,
  ): SkillCatalogEntry {
    const yamlRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(yamlRegex);

    if (!match) {
      const msg = text.skills.missingFrontmatter(filePath);
      safeLogger().error(msg);
      throw new Error(msg);
    }

    const yamlRaw = match[1];

    let parsed: unknown;
    try {
      parsed = parseYaml(yamlRaw);
    } catch (originalErr) {
      // Attempt YAML fallback recovery
      const { fixed, correctedLines } = SkillParser.fixCommonYamlIssues(yamlRaw);
      try {
        parsed = parseYaml(fixed);
        // Fallback succeeded — log warning identifying corrected lines
        safeLogger().warn(text.skills.yamlFallbackApplied(filePath, correctedLines.join(', ')));
      } catch (_fallbackErr) {
        // Fallback also failed — log original error and throw
        const reason = originalErr instanceof Error ? originalErr.message : String(originalErr);
        safeLogger().warn(text.skills.yamlFallbackFailed(filePath));
        const msg = text.skills.yamlParseError(filePath, reason);
        safeLogger().error(msg);
        throw new Error(msg);
      }
    }

    if (parsed == null || typeof parsed !== 'object') {
      const msg = text.skills.missingFrontmatter(filePath);
      safeLogger().error(msg);
      throw new Error(msg);
    }

    const schema = strict ? SkillFrontmatterSchema : SkillFrontmatterBaseSchema;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      const msg = text.skills.invalidFrontmatter(filePath, issues);
      safeLogger().error(msg);
      throw new Error(msg);
    }

    const data = result.data as SkillFrontmatter;

    // In lenient mode, check non-fatal constraints and log warnings
    if (!strict) {
      if (data.name.length > 64) {
        safeLogger().warn(text.skills.nameTooLong(filePath, data.name, data.name.length));
      }
      if (!SKILL_NAME_REGEX.test(data.name) || data.name.includes('--')) {
        safeLogger().warn(text.skills.nameFormatWarning(filePath, data.name));
      }
      if (data.description.length > 1024) {
        safeLogger().warn(text.skills.descriptionTooLong(filePath, data.description.length));
      }
    }

    // Validate name matches parent directory (Requirement 5.3)
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && parentDir !== '.' && parentDir !== data.name) {
      const msg = text.skills.nameDirMismatch(filePath, parentDir, data.name);
      if (strict) {
        safeLogger().error(msg);
        throw new Error(msg);
      } else {
        safeLogger().warn(msg);
      }
    }

    return {
      id: data.name,
      name: data.name,
      description: data.description,
      location: filePath,
      scope,
      conditionalPaths: data.paths,
      userInvocable: data.userInvocable,
    };
  }

  /**
   * Attempt to fix common YAML issues in frontmatter content.
   *
   * Targets the most common cross-client issue: unquoted values containing colons.
   * For each line matching `key: value...` where the value contains an unquoted colon,
   * wraps the value portion in double quotes (escaping internal quotes).
   *
   * Lines that are YAML structural elements are left untouched:
   * - Bare mapping keys (e.g. `metadata:`)
   * - List items (starting with `- `)
   * - Already-quoted values (value starts with `"` or `'`)
   * - Comment lines (starting with `#`)
   * - Empty or whitespace-only lines
   *
   * @param yamlContent - Raw YAML string from between --- delimiters
   * @returns Corrected YAML string and list of corrected line descriptions
   * @see Requirements 2.1, 2.4, 2.6
   */
  static fixCommonYamlIssues(yamlContent: string): { fixed: string; correctedLines: string[] } {
    const lines = yamlContent.split('\n');
    const correctedLines: string[] = [];

    const fixedLines = lines.map((line) => {
      const trimmed = line.trimStart();

      // Skip empty / whitespace-only lines
      if (trimmed.length === 0) return line;

      // Skip comment lines
      if (trimmed.startsWith('#')) return line;

      // Skip list items (e.g. `- item` or `  - item`)
      if (trimmed.startsWith('- ')) return line;

      // Match `key: value` pattern — the key is everything before the first `: `
      const colonSpaceIdx = line.indexOf(': ');
      if (colonSpaceIdx === -1) return line;

      // Extract the key portion (before first `: `) and validate it looks like a YAML key
      const key = line.slice(0, colonSpaceIdx);

      // Skip if the key itself is empty or contains characters unlikely in a YAML key
      // (e.g. starts with whitespace followed by a dash, which is a list context)
      if (key.trim().length === 0) return line;

      const value = line.slice(colonSpaceIdx + 2);

      // Skip bare mapping keys (value is empty after the colon-space)
      if (value.trim().length === 0) return line;

      // Skip already-quoted values (single or double quotes)
      const valueTrimmed = value.trimStart();
      if (valueTrimmed.startsWith('"') || valueTrimmed.startsWith("'")) return line;

      // Skip values that start with YAML structural indicators (block scalars, anchors, etc.)
      if (valueTrimmed.startsWith('|') || valueTrimmed.startsWith('>') ||
          valueTrimmed.startsWith('&') || valueTrimmed.startsWith('*') ||
          valueTrimmed.startsWith('[') || valueTrimmed.startsWith('{')) return line;

      // Check if the value portion contains an additional colon followed by a space
      // This is the heuristic: only fix lines where the value clearly has an unquoted colon
      if (!value.includes(': ')) return line;

      // Wrap the value in double quotes, escaping any internal double quotes and backslashes
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const fixedLine = `${key}: "${escaped}"`;

      correctedLines.push(`${key.trim()}: value contained unquoted colon`);

      return fixedLine;
    });

    return {
      fixed: fixedLines.join('\n'),
      correctedLines,
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
