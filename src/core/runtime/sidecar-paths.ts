import os from 'node:os';

import { defaultPathAdapter, type PathAdapter } from '../adapters/path/path-adapter.js';

type UserDataPathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  pathAdapter?: PathAdapter;
  appName?: string;
};

const DEFAULT_APP_NAME = 'SalmonLoop';

export function resolveUserDataDir(options?: UserDataPathOptions): string {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const home = options?.homedir ?? os.homedir();
  const pathAdapter = options?.pathAdapter ?? defaultPathAdapter;
  const appName = options?.appName ?? DEFAULT_APP_NAME;

  if (platform === 'win32') {
    const base = env.APPDATA ?? env.LOCALAPPDATA ?? pathAdapter.join(home, 'AppData', 'Roaming');
    return pathAdapter.join(base, appName);
  }

  if (platform === 'darwin') {
    return pathAdapter.join(home, 'Library', 'Application Support', appName);
  }

  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : pathAdapter.join(home, '.local', 'share');
  return pathAdapter.join(base, appName);
}

export function getSidecarSocketPath(
  options?: UserDataPathOptions & { socketName?: string },
): string {
  const platform = options?.platform ?? process.platform;
  const socketName = options?.socketName ?? 'agent-message.sock';

  if (platform === 'win32') {
    return '\\\\.\\pipe\\salmonloop-agent-message';
  }

  const dataDir = resolveUserDataDir(options);
  const pathAdapter = options?.pathAdapter ?? defaultPathAdapter;
  return pathAdapter.join(dataDir, 'sidecar', socketName);
}
