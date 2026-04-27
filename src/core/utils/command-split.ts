export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  const tokenPattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(command)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[0]);
  }
  return parts;
}
