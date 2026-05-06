export function splitCommand(command: string): { file: string; args: string[] } {
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(command)) !== null) {
    if (match[1] !== undefined) {
      parts.push(match[1]);
    } else if (match[2] !== undefined) {
      parts.push(match[2]);
    } else {
      parts.push(match[0]);
    }
  }

  if (parts.length === 0) {
    return { file: command, args: [] };
  }

  return { file: parts[0], args: parts.slice(1) };
}
