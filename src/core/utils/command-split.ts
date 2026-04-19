export function splitCommand(cmd: string): string[] {
  const args: string[] = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar: string | null = null;
  let escapeNext = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];

    if (escapeNext) {
      currentArg += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = null;
      } else {
        currentArg += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = '';
      }
      continue;
    }

    currentArg += char;
  }

  if (currentArg.length > 0) {
    args.push(currentArg);
  }

  return args;
}
