export type {
  InteractiveProcess,
  ProcessFailure,
  ProcessFailureKind,
  SpawnCommandInput,
  SpawnCommandResult,
  SpawnInteractiveInput,
} from './process-types.js';

export { isCommandAvailable, spawnCommand } from './spawn-command.js';
export { spawnInteractiveProcess } from './spawn-interactive.js';
