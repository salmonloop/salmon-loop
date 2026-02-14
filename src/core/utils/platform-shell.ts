export interface ShellInvocation {
  file: string;
  args: string[];
}

export function getPlatformShellInvocation(command: string): ShellInvocation {
  if (process.platform === 'win32') {
    const file = process.env.ComSpec || 'cmd.exe';
    return { file, args: ['/d', '/s', '/c', command] };
  }

  // Match Node.js child_process default as closely as possible.
  // See: child_process spawn/exec `shell: true` behavior on POSIX.
  return { file: '/bin/sh', args: ['-c', command] };
}
