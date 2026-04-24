export function splitCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ') {
        if (current.length > 0) {
          result.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}
