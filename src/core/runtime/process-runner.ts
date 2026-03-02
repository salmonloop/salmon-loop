export type {
  InteractiveProcess,
  ProcessFailure,
  ProcessFailureKind,
  SpawnCommandInput,
  SpawnCommandResult,
  SpawnInteractiveInput,
} from './process-types.js';

import { getActiveCommandRunner } from './command-runner-context.js';
import type { SpawnCommandInput, SpawnCommandResult } from './process-types.js';
import { isCommandAvailableLocal, spawnCommandLocal } from './spawn-command.js';

export async function spawnCommand(input: SpawnCommandInput): Promise<SpawnCommandResult> {
  const runner = getActiveCommandRunner();
  if (runner) return await runner.spawnCommand(input);
  return await spawnCommandLocal(input);
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  const runner = getActiveCommandRunner();
  if (runner) return await runner.isCommandAvailable(command);
  return await isCommandAvailableLocal(command);
}

export { spawnInteractiveProcess } from './spawn-interactive.js';
