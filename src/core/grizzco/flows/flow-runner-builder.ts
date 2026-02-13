import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { FileStateResolver } from '../../strata/layers/file-state-resolver.js';
import { WorkspaceSynchronizer } from '../../strata/runtime/synchronizer.js';
import type {
  CheckpointRef,
  ExecutionWorkspace,
  FileSystem,
  FlowMode,
  LoopEvent,
  LoopOptions,
} from '../../types.js';

import type { LoopTelemetry } from './flow-telemetry.js';
import { FlowTransactionRunner } from './flow-transaction-runner.js';

interface BuildFlowRunnerEnvironment {
  workspace?: ExecutionWorkspace;
  initialSnapshotHash?: string;
  checkpointRef?: CheckpointRef;
  checkpointManager: ConstructorParameters<typeof WorkspaceSynchronizer>[0];
}

export interface BuildFlowRunnerParams {
  flowMode: FlowMode;
  fsAdapter: FileSystem;
  env: BuildFlowRunnerEnvironment;
  activeRepoPath: string;
  planRuntime?: { sessionId: string; planPathHint: string };
  options: LoopOptions;
  emitFlow: (event: LoopEvent) => void;
  now: () => Date;
  telemetry: LoopTelemetry;
  shadowTaskId: string;
}

function requireWorkspace(workspace: ExecutionWorkspace | undefined): ExecutionWorkspace {
  if (!workspace) {
    throw new Error('Runtime environment missing workspace after setup');
  }
  return workspace;
}

function resolveShadowInitialRef(params: {
  initialSnapshotHash?: string;
  optionsShadowInitialRef?: string;
}): string {
  return params.initialSnapshotHash || params.optionsShadowInitialRef || '';
}

export function buildFlowTransactionRunner(params: BuildFlowRunnerParams): FlowTransactionRunner {
  const {
    env,
    flowMode,
    fsAdapter,
    activeRepoPath,
    planRuntime,
    options,
    emitFlow,
    now,
    telemetry,
    shadowTaskId,
  } = params;

  const checkpointManager = env.checkpointManager;
  const workspace = requireWorkspace(env.workspace);
  const shadowInitialRef = resolveShadowInitialRef({
    initialSnapshotHash: env.initialSnapshotHash,
    optionsShadowInitialRef: options.shadowInitialRef,
  });
  const synchronizer = new WorkspaceSynchronizer(checkpointManager);
  const git = new GitAdapter(activeRepoPath);
  const resolver = new FileStateResolver(git, activeRepoPath);

  return new FlowTransactionRunner({
    options,
    flowMode,
    emit: emitFlow,
    now,
    fsAdapter,
    env: {
      workspace,
      shadowInitialRef,
      initialSnapshotHash: env.initialSnapshotHash,
      checkpointRef: env.checkpointRef,
      activeRepoPath,
    },
    synchronizer,
    shadowTaskId,
    planRuntime,
    fileStateResolver: resolver,
    telemetry,
  });
}
