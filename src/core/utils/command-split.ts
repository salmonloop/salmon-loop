/**
 * Safely parses a command string into an array of arguments, handling simple quotes.
 * This is used as a fallback when an explicit args array is not provided, allowing
 * us to avoid the shell: true command injection risk.
 */
export function splitCommand(command: string): string[] {
  const result: string[] = [];
  let currentWord = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
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

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char.trim() === '' && !inSingleQuote && !inDoubleQuote) {
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
