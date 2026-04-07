import path from 'node:path';

import { text } from '../../locales/index.js';
import { syncFs as fs } from '../adapters/fs/node-fs.js';
import { tryGetLogger } from '../observability/logger.js';

/**
 * Match strategy for a skill permission policy.
 *
 * - `exact`: permission granted for a specific skill id only
 * - `prefix`: permission granted for all skills whose id starts with the given pattern
 */
export type SkillPermissionMatchKind = 'exact' | 'prefix';

/**
 * A single permission policy entry that grants access to one or more skills.
 *
 * Supports exact match (single skill) and prefix match (skill id prefix).
 * Includes provenance tracking for auditability.
 */
export interface SkillPermissionPolicy {
  /** The skill id (exact) or skill id prefix (prefix) to match against. */
  pattern: string;
  /** Match strategy: 'exact' for a single skill, 'prefix' for all skills starting with pattern. */
  kind: SkillPermissionMatchKind;
  /** Who granted this permission (e.g. 'user', 'admin', 'cli'). */
  grantedBy: string;
  /** ISO 8601 timestamp of when the permission was granted. */
  grantedAt: string;
}

/**
 * Serialized format for the skill permissions JSON file.
 */
interface SkillPermissionsFile {
  version: 1;
  policies: SkillPermissionPolicy[];
}

/**
 * Manages skill-level permission policies with exact and prefix matching.
 *
 * Persists policies to a JSON file for auditable provenance tracking.
 * Aligns with the existing permission-rules pattern in the tools layer.
 */
export class SkillPermissionManager {
  private policies: SkillPermissionPolicy[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  /**
   * Check whether a skill id is allowed by any active policy.
   *
   * Evaluates all policies in order: exact matches are checked first,
   * then prefix matches. Returns true if any policy matches.
   */
  isAllowed(skillId: string): boolean {
    for (const policy of this.policies) {
      if (policy.kind === 'exact' && policy.pattern === skillId) {
        return true;
      }
      if (policy.kind === 'prefix' && skillId.startsWith(policy.pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Grant a new permission policy. Deduplicates by pattern+kind.
   * Persists the updated allowlist to disk.
   */
  grant(policy: SkillPermissionPolicy): void {
    const existing = this.policies.findIndex(
      (p) => p.pattern === policy.pattern && p.kind === policy.kind,
    );
    if (existing >= 0) {
      // Update provenance on re-grant
      this.policies[existing] = policy;
    } else {
      this.policies.push(policy);
    }

    const logger = tryGetLogger();
    logger?.audit(
      'SKILL_PERMISSION_GRANTED',
      {
        pattern: policy.pattern,
        kind: policy.kind,
        grantedBy: policy.grantedBy,
        grantedAt: policy.grantedAt,
      },
      { source: 'skill-permissions', severity: 'low', scope: 'session' },
    );

    this.save();
  }

  /**
   * Revoke all policies matching a given skill id (exact match on pattern).
   * Persists the updated allowlist to disk.
   */
  revoke(skillId: string): void {
    const before = this.policies.length;
    this.policies = this.policies.filter((p) => p.pattern !== skillId);

    if (this.policies.length < before) {
      const logger = tryGetLogger();
      logger?.audit(
        'SKILL_PERMISSION_REVOKED',
        { skillId, removedCount: before - this.policies.length },
        { source: 'skill-permissions', severity: 'low', scope: 'session' },
      );
      this.save();
    }
  }

  /** Return a readonly snapshot of current policies. */
  getPolicies(): readonly SkillPermissionPolicy[] {
    return [...this.policies];
  }

  /** Load policies from the persisted JSON file. */
  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.policies = [];
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data: SkillPermissionsFile = JSON.parse(raw);
      if (data.version === 1 && Array.isArray(data.policies)) {
        this.policies = data.policies;
      } else {
        const logger = tryGetLogger();
        logger?.warn(text.skills.permissionFileInvalidFormat(this.filePath));
        this.policies = [];
      }
    } catch {
      const logger = tryGetLogger();
      logger?.warn(text.skills.permissionFileLoadError(this.filePath));
      this.policies = [];
    }
  }

  /** Persist current policies to the JSON file. */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: SkillPermissionsFile = {
        version: 1,
        policies: this.policies,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      const logger = tryGetLogger();
      logger?.error(
        text.skills.permissionFileSaveError(
          this.filePath,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }
}
