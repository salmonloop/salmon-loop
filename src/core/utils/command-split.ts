export function splitCommand(command: string): string[] {
  const regex = /"[^"]+"|'[^']+'|\S+/g;
  const matches = command.match(regex);
  if (!matches) return [];
  return matches.map((m) => {
    if ((m.startsWith('"') && m.endsWith('"')) || (m.startsWith("'") && m.endsWith("'"))) {
      return m.slice(1, -1);
    }
    return m;
  });
}
