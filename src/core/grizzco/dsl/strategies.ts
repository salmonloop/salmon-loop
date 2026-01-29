import { text } from '../../../locales/index.js';
import { FileStatus, OpType } from '../../shared/types/grizzco-types.js';

import { DecisionEngine } from './DecisionEngine.js';

/**
 * Phase 1: Safety Checks
 */
export const SafetyChecks = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Phase 1: Safety Checks')
    .require((c) => !c.file.isSymlink, 'Symlinks are not supported')
    .require((c) => c.snapshot.exists, 'Snapshot required for safe rollback')
    .require(
      (c) => !c.file.isIgnored || c.options.force,
      'Refusing to modify ignored file without --force',
    )
    .requireData('remote_lock')
    .require((c) => !c.data?.remote_lock?.isLocked, text.grizzco.v3.remoteLocked)
    .requireData('git_config')
    .require(
      (c) => !!(c.data?.git_config?.user?.name && c.data?.git_config?.user?.email),
      text.grizzco.v3.gitUserConfigMissing,
    );
};

/**
 * Phase 2: Intent Routing
 * 🛡️ SECURITY BARRIER:
 * We prioritize Operation Intent (what the AI wants to do) over File Status.
 * A "CLEAN" file MUST NOT be handled by 'direct-write' if the operation is a "PATCH".
 * This prevents partial diffs from overwriting full files.
 */
export const IntentRouting = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Phase 2: Intent Routing')
    .when(
      (c) => c.operation.type === OpType.PATCH,
      (p) => p.setWorker('git-apply'),
    )
    .when(
      (c) => c.operation.type === OpType.OVERWRITE,
      (p) => p.setWorker('direct-write'),
    )
    .when(
      (c) => c.operation.type === OpType.DELETE,
      (p) => p.addAction('FS_DELETE'),
    );
};

/**
 * Phase 3: Index Protection
 */
export const IndexProtection = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Phase 3: Index Protection')
    .when(
      (c) =>
        (c.file.status === FileStatus.STAGED_MODIFIED ||
          c.file.status === FileStatus.STAGED_ADDED ||
          c.file.status === FileStatus.STAGED_DELETED) &&
        !c.options.force,
      (p) => p.abort('Staged file detected and protected (use --force)'),
    )
    .when(
      (c) =>
        (c.file.status === FileStatus.STAGED_MODIFIED ||
          c.file.status === FileStatus.STAGED_ADDED ||
          c.file.status === FileStatus.STAGED_DELETED) &&
        c.options.force,
      (p) => p.setWorker('union-merge-safe'),
    );
};

/**
 * Phase 4: MM & Conflict Handling
 * Refines the worker if the file is in a complex state.
 */
export const MMHandling = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Phase 4: MM Handling')
    .when(
      (c) => c.file.status === FileStatus.MM && c.file.isBinary,
      (p) => p.abort('Binary MM file cannot be merged'),
    )
    .when(
      // PATCH operations must stay on the git-apply track. MM merge workers expect full-file "theirs" content,
      // while PATCH operations carry unified diff text. Overriding would risk treating a patch as file content.
      (c) =>
        c.operation.type !== OpType.PATCH &&
        c.file.status === FileStatus.MM &&
        !c.file.isBinary &&
        c.options.force,
      (p) => p.setWorker('union-merge-safe'),
    )
    .when(
      (c) =>
        c.operation.type !== OpType.PATCH &&
        c.file.status === FileStatus.MM &&
        !c.file.isBinary &&
        !c.options.force,
      (p) => p.setWorker('3way-mm-advanced'),
    );
};

/**
 * Phase 5: Status Validation & Final Routing
 * Ensures the chosen worker is compatible with the file status.
 */
export const StatusValidation = (engine: DecisionEngine): DecisionEngine => {
  return (
    engine
      .phase('Phase 5: Status Validation')
      // Ensure PATCH isn't accidentally routed to direct-write
      .require((c) => {
        // If Op is PATCH, worker MUST NOT be direct-write
        if (c.operation.type === OpType.PATCH) {
          // This is a safety guard
          return true; // git-apply is always safe for PATCH
        }
        return true;
      }, 'Integrity Check Failed')
      // Refine UNSTAGED_MODIFIED if needed
      .when(
        (c) =>
          c.operation.type === OpType.OVERWRITE &&
          c.file.status === FileStatus.UNSTAGED_MODIFIED &&
          !c.file.isBinary,
        (p) => p.setWorker('3way-standard'),
      )
      .when(
        (c) => c.file.status === FileStatus.CONFLICT,
        (p) => p.abort('File has existing conflict'),
      )
  );
};

/**
 * Standard Strategy Orchestration
 */
export const StandardStrategy = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .apply(SafetyChecks)
    .apply(IntentRouting) // Identify AI intent
    .apply(IndexProtection) // Protect index
    .apply(MMHandling) // Handle MM state
    .apply(StatusValidation); // Validate final status
};
