/**
 * Centralized feature flags for the skills subsystem.
 *
 * Provides staged rollout control over parser strictness, loader format,
 * and bridge execution. Each flag is readable from an environment variable
 * with a sensible default.
 *
 * @see Requirements 11.4
 */

import { tryGetLogger } from '../observability/logger.js';

// ---------------------------------------------------------------------------
// Flag interface
// ---------------------------------------------------------------------------

export interface SkillFeatureFlags {
  /**
   * When true, the parser rejects name-directory mismatches with an error.
   * When false (compat mode), mismatches produce a warning only.
   *
   * Env: `SALMONLOOP_SKILL_PARSER_STRICT`
   * Default: `false`
   */
  parserStrict: boolean;

  /**
   * When true, the loader also accepts legacy direct `.md` files under a
   * skills root (with a deprecation warning). When false, only the
   * canonical `skill-name/SKILL.md` subdirectory format is loaded.
   *
   * Env: `SALMONLOOP_SKILL_LEGACY_DIRECT_MD`
   * Default: `false`
   */
  legacyDirectMd: boolean;

  /**
   * When true, the bridge execution path is disabled (kill-switch ON).
   * `skillToToolSpec()` will return a DENIED result with an audit event.
   *
   * Env: `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC`
   * Default: `true` in non-development environments, `false` in development.
   */
  bridgeDisabled: boolean;
}

// ---------------------------------------------------------------------------
// Env-var helpers
// ---------------------------------------------------------------------------

/**
 * Parse a boolean-ish env var value.
 * Returns `true` for 'true'/'1', `false` for 'false'/'0', or the
 * provided `fallback` when the value is undefined/empty.
 */
function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read all skill-related feature flags from environment variables.
 *
 * The function is intentionally pure (no caching) so that tests can
 * manipulate `process.env` between calls and observe the effect.
 *
 * @returns A snapshot of the current feature flag values
 * @see Requirements 11.4
 */
export function getSkillFeatureFlags(): SkillFeatureFlags {
  const bridgeDefault = process.env.NODE_ENV !== 'development';

  return {
    parserStrict: parseBoolEnv(process.env.SALMONLOOP_SKILL_PARSER_STRICT, false),
    legacyDirectMd: parseBoolEnv(process.env.SALMONLOOP_SKILL_LEGACY_DIRECT_MD, false),
    bridgeDisabled: parseBoolEnv(process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC, bridgeDefault),
  };
}

/**
 * Log the current feature flag values at debug level.
 *
 * Useful at startup to record which flags are active for diagnostics.
 */
export function logSkillFeatureFlags(): void {
  const flags = getSkillFeatureFlags();
  const logger = tryGetLogger();
  logger?.debug(
    `Skill feature flags: parserStrict=${flags.parserStrict}, legacyDirectMd=${flags.legacyDirectMd}, bridgeDisabled=${flags.bridgeDisabled}`,
  );
}
