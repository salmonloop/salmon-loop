/**
 * Safely splits a command string into a command and arguments array
 * without using a shell to avoid command injection.
 */
export function splitCommand(command: string): { cmd: string; args: string[] } {
  if (!command || !command.trim()) {
    return { cmd: '', args: [] };
  }

  // Regex to split by spaces, but ignoring spaces inside single or double quotes
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

  if (parts.length === 0) {
    return { cmd: '', args: [] };
  }

  const cleanParts = parts.map((part) => {
    // Remove surrounding quotes if present
    if (part.startsWith('"') && part.endsWith('"') && part.length >= 2) {
      return part.slice(1, -1);
    }
    if (part.startsWith("'") && part.endsWith("'") && part.length >= 2) {
      return part.slice(1, -1);
    }
    return part;
  });

  return {
    cmd: cleanParts[0],
    args: cleanParts.slice(1),
  };
}
