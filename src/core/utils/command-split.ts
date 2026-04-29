export function splitCommand(cmdString: string): { file: string; args: string[] } {
  if (!cmdString || typeof cmdString !== 'string') {
    return { file: '', args: [] };
  }
  const parts = cmdString.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const processed = parts.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });

  if (processed.length === 0) return { file: '', args: [] };
  return { file: processed[0], args: processed.slice(1) };
}
