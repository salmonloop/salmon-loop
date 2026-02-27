import type { NodePackageManager, NodeRuntimeProfile } from './profile.js';

export interface ResolvedScriptCommand {
  packageManager: NodePackageManager;
  scriptName: string;
  command: string;
  args: string[];
  shellCommand: string;
}

function quoteShellArg(arg: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) return arg;
  return JSON.stringify(arg);
}

export function formatShellCommand(command: string, args: string[]): string {
  return [quoteShellArg(command), ...args.map(quoteShellArg)].join(' ');
}

export function resolveScriptCommand(
  profile: NodeRuntimeProfile,
  scriptName: string,
): ResolvedScriptCommand | undefined {
  if (!profile.scripts[scriptName]) return undefined;

  const command = profile.packageManager;
  const args = ['run', scriptName];

  return {
    packageManager: profile.packageManager,
    scriptName,
    command,
    args,
    shellCommand: formatShellCommand(command, args),
  };
}

export function resolveNodeVerifyCommand(profile: NodeRuntimeProfile): string | undefined {
  return resolveScriptCommand(profile, 'test')?.shellCommand;
}

export function resolveNodeWorktreePrepareCommand(profile: NodeRuntimeProfile): string {
  const hasLockfile = profile.source === 'lockfile';

  switch (profile.packageManager) {
    case 'bun':
      return hasLockfile ? 'bun install --frozen-lockfile' : 'bun install';
    case 'pnpm':
      return hasLockfile ? 'pnpm install --frozen-lockfile' : 'pnpm install';
    case 'yarn':
      return hasLockfile ? 'yarn install --immutable' : 'yarn install';
    case 'npm':
      return hasLockfile ? 'npm ci' : 'npm install';
    default: {
      const manager: never = profile.packageManager;
      return manager;
    }
  }
}
