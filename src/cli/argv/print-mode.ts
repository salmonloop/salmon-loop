export const CLI_ROOT_COMMANDS = new Set([
  'run',
  'serve',
  'chat',
  'context',
  'restore',
  'checkout',
  'snapshot',
  'snap',
]);

const PRINT_MODE_FLAGS_WITH_VALUES = new Set([
  '-p',
  '--print',
  '-r',
  '--repo',
  '--resume',
  '-v',
  '--verify',
  '-cs',
  '--checkpoint-strategy',
  '--llm-output',
]);

function startsWithAny(value: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return true;
  }
  return false;
}

export function rewriteArgvForPrintMode(argv: string[]): string[] {
  const tokens = argv.slice(2);
  const hasPrint = tokens.some((t) => t === '-p' || t === '--print' || t.startsWith('--print='));
  if (!hasPrint) return argv;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') break;

    if (PRINT_MODE_FLAGS_WITH_VALUES.has(token)) {
      i += 1;
      continue;
    }

    if (
      startsWithAny(token, [
        '--print=',
        '--repo=',
        '--resume=',
        '--verify=',
        '--checkpoint-strategy=',
        '--llm-output=',
      ])
    ) {
      continue;
    }

    if (token.startsWith('-')) continue;
    if (CLI_ROOT_COMMANDS.has(token)) return argv;
  }

  return [...argv.slice(0, 2), 'run', ...tokens];
}
