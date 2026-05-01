export function splitCommand(command: string): string[] {
  const result: string[] = [];
  let currentWord = '';
  let inQuotes: string | null = null;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escapeNext) {
      currentWord += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (inQuotes) {
      if (char === inQuotes) {
        inQuotes = null;
      } else {
        currentWord += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuotes = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (currentWord.length > 0) {
        result.push(currentWord);
        currentWord = '';
      }
      continue;
    }

    currentWord += char;
  }

  if (currentWord.length > 0) {
    result.push(currentWord);
  }

  return result;
}
