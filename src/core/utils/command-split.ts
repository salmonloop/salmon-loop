/**
 * Safely splits a command string into its executable and arguments.
 * This is a basic implementation that handles spaces and simple quotes.
 * For complex shell-like parsing, a more robust library might be needed,
 * but for our purposes of avoiding `shell: true`, this should suffice for typical usage.
 */
export function splitCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes: string | null = null;
  let escaped = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inQuotes) {
      if (char === inQuotes) {
        inQuotes = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuotes = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}
