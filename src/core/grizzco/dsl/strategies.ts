import { text } from '../../../locales/index.js';
import { FileStatus, OpType } from '../domain/grizzco-types.js';

import { DecisionEngine } from './DecisionEngine.js';

const isStaged = (status: FileStatus): boolean =>
  status === FileStatus.STAGED_MODIFIED ||
  status === FileStatus.STAGED_ADDED ||
  status === FileStatus.STAGED_DELETED;

/**
 * StandardStrategy keeps macro orchestration outside the DSL and only expresses
 * per-file decision rules in a synchronous, auditable chain.
 */
export const SafetyChecks = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Security')
    .require((c) => !c.file.isSymlink, 'Symlinks are not supported')
    .require((c) => c.snapshot.exists, 'Snapshot required for safe rollback')
    .require(
      (c) => !c.file.isIgnored || c.options.force,
      'Refusing to modify ignored file without --force',
    )
    .phase('Lock Check')
    .requireData('remote_lock')
    .require((c) => !c.data?.remote_lock?.isLocked, text.grizzco.remoteLocked)
    .requireData('git_config')
    .require(
      (c) => !!(c.data?.git_config?.user?.name && c.data?.git_config?.user?.email),
      text.grizzco.gitUserConfigMissing,
    );
};

export const IntentRouting = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Routing')
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

export const IndexProtection = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Index Protection')
    .when(
      (c) => isStaged(c.file.status) && !c.options.force,
      (p) => p.reject(text.grizzco.stagedFileProtected),
    )
    .when(
      (c) => isStaged(c.file.status) && c.options.force,
      (p) => p.setWorker('union-merge-safe'),
    );
};

export const MMHandling = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('MM Handling')
    .when(
      (c) => c.file.status === FileStatus.MM && c.file.isBinary,
      (p) => p.reject(text.grizzco.binaryMmCannotBeMerged),
    )
    .when(
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

export const StatusValidation = (engine: DecisionEngine): DecisionEngine => {
  return engine
    .phase('Status Validation')
    .when(
      (c) =>
        c.operation.type === OpType.OVERWRITE &&
        c.file.status === FileStatus.UNSTAGED_MODIFIED &&
        !c.file.isBinary,
      (p) => p.setWorker('3way-standard'),
    )
    .when(
      (c) => c.file.status === FileStatus.CONFLICT,
      (p) => p.reject(text.grizzco.fileHasExistingConflict),
    );
};

export const StandardStrategy = (engine: DecisionEngine): DecisionEngine => {
  return StatusValidation(
    MMHandling(IndexProtection(IntentRouting(SafetyChecks(engine)))),
  ).setWorker('direct-write');
};
