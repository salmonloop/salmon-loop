export function splitCommand(cmd: string): string[] {
  const matches = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) return [];
  return matches.map((m) => {
    if ((m.startsWith('"') && m.endsWith('"')) || (m.startsWith("'") && m.endsWith("'"))) {
      return m.slice(1, -1);
    }
    return m;
  });
}
