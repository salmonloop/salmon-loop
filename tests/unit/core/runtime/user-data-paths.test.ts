import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  getSidecarSocketPath,
  resolveUserDataDir,
} from '../../../../src/core/runtime/sidecar-paths.js';

function createPathAdapter(module: typeof path.posix) {
  return {
    join: module.join.bind(module),
    resolve: module.resolve.bind(module),
    dirname: module.dirname.bind(module),
    basename: module.basename.bind(module),
    relative: module.relative.bind(module),
    isAbsolute: module.isAbsolute.bind(module),
  };
}

describe('user data paths', () => {
  test('prefers XDG data home on linux', () => {
    const dir = resolveUserDataDir({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/xdg' },
      homedir: '/home/test',
      pathAdapter: createPathAdapter(path.posix),
      appName: 'SalmonLoop',
    });

    expect(dir).toBe('/xdg/SalmonLoop');
  });

  test('uses default linux data dir when XDG is missing', () => {
    const dir = resolveUserDataDir({
      platform: 'linux',
      env: {},
      homedir: '/home/test',
      pathAdapter: createPathAdapter(path.posix),
      appName: 'SalmonLoop',
    });

    expect(dir).toBe('/home/test/.local/share/SalmonLoop');
  });

  test('uses macOS application support directory', () => {
    const dir = resolveUserDataDir({
      platform: 'darwin',
      env: {},
      homedir: '/Users/test',
      pathAdapter: createPathAdapter(path.posix),
      appName: 'SalmonLoop',
    });

    expect(dir).toBe('/Users/test/Library/Application Support/SalmonLoop');
  });

  test('uses windows appdata directory', () => {
    const dir = resolveUserDataDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\\\Users\\\\test\\\\AppData\\\\Roaming' },
      homedir: 'C:\\\\Users\\\\test',
      pathAdapter: createPathAdapter(path.win32),
      appName: 'SalmonLoop',
    });

    expect(dir).toBe(path.win32.join('C:\\\\Users\\\\test\\\\AppData\\\\Roaming', 'SalmonLoop'));
  });

  test('builds the sidecar socket path', () => {
    const socketPath = getSidecarSocketPath({
      platform: 'linux',
      env: {},
      homedir: '/home/test',
      pathAdapter: createPathAdapter(path.posix),
    });

    expect(socketPath).toBe('/home/test/.local/share/SalmonLoop/sidecar/agent-message.sock');
  });
});
