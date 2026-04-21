export function splitCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escapeNext) {
      current += char;
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
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}
