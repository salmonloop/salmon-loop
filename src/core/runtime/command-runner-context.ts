import { AsyncLocalStorage } from 'async_hooks';

import type { SpawnCommandInput, SpawnCommandResult } from './process-types.js';
import { isCommandAvailableLocal, spawnCommandLocal } from './spawn-command.js';

export interface CommandRunner {
  spawnCommand: (input: SpawnCommandInput) => Promise<SpawnCommandResult>;
  isCommandAvailable: (command: string) => Promise<boolean>;
}

const storage = new AsyncLocalStorage<CommandRunner>();

export function getActiveCommandRunner(): CommandRunner | undefined {
  return storage.getStore();
}

export function createLocalCommandRunner(): CommandRunner {
  return {
    spawnCommand: spawnCommandLocal,
    isCommandAvailable: isCommandAvailableLocal,
  };
}

export function withCommandRunner<T>(
  runner: CommandRunner,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(runner, fn);
}
