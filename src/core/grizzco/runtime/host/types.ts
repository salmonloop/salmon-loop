import type { RuntimeEnvironment } from '../../../strata/runtime/environment.js';
import type { FileSystem, FlowMode } from '../../../types.js';

export interface PlanRuntimeContext {
  sessionId: string;
  planPathHint: string;
}

export interface HostBootContext {
  flowMode: FlowMode;
  fsAdapter: FileSystem;
  env: RuntimeEnvironment;
  activeRepoPath: string;
  planRuntime?: PlanRuntimeContext;
}
